"""Synthesize narrative threads from news items."""
import logging
from datetime import datetime, timezone, timedelta
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from models import NewsItem, MilitaryEvent, NarrativeThread
from . import ollama_client

logger = logging.getLogger(__name__)

async def run_synthesis(db: AsyncSession, lookback_hours: int = 48) -> int:
    """
    Look at news from the last N hours that don't have a thread_id,
    and try to cluster them using LLM.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(hours=lookback_hours)
    
    # 1. Fetch unthreaded news items
    stmt = select(NewsItem).where(
        NewsItem.processed == True,
        NewsItem.thread_id == None,
        NewsItem.fetched_at >= cutoff
    ).limit(15) # reduced batch size for better LLM focus
    
    result = await db.execute(stmt)
    items = result.scalars().all()
    
    if len(items) < 3:
        logger.info("Not enough new items to synthesize narrative threads")
        return 0

    # 2. Prepare items for LLM
    data_for_llm = [
        {"id": item.id, "title": item.title, "summary": item.summary_zh or item.title}
        for item in items
    ]
    
    # 3. Call LLM to identify threads
    raw_threads = await ollama_client.identify_narrative_threads(data_for_llm)
    # 兼容包装结构：{ "threads" | "data" | "items": [...] }
    if isinstance(raw_threads, list):
        threads_data = raw_threads
    elif isinstance(raw_threads, dict):
        for key in ("threads", "data", "items"):
            if isinstance(raw_threads.get(key), list):
                threads_data = raw_threads[key]
                break
        else:
            threads_data = [raw_threads]
    else:
        logger.error("LLM returned invalid data format: %s", type(raw_threads))
        return 0

    from models import CausalLink
    valid_ids = {item.id for item in items}
    count = 0
    for t_data in threads_data:
        if not isinstance(t_data, dict):
            logger.warning("Skipping invalid thread data entry: %s", t_data)
            continue

        try:
            raw_item_ids = t_data.get("item_ids", [])
            item_ids = [iid for iid in raw_item_ids if iid in valid_ids]
            if raw_item_ids and not item_ids:
                logger.warning("Thread item_ids all invalid (valid set size %d), skipping", len(valid_ids))
                continue
            title = t_data.get("title")
            if not item_ids or not title:
                continue
            
            # Create a new Narrative Thread
            category_val = t_data.get("category", "other")
            if isinstance(category_val, list):
                category_val = ", ".join(map(str, category_val))
            
            summary_val = t_data.get("summary", "")
            if isinstance(summary_val, list):
                summary_val = " ".join(map(str, summary_val))

            thread = NarrativeThread(
                title=str(title),
                summary=str(summary_val),
                category=str(category_val)[:50],
                start_time=datetime.now(timezone.utc),
                last_updated=datetime.now(timezone.utc)
            )
            db.add(thread)
            await db.flush() # get ID
            
            # Link items to thread; collect news + events for causal inference
            threaded_items = []
            event_ids_linked = set()
            for iid in item_ids:
                await db.execute(
                    update(NewsItem)
                    .where(NewsItem.id == iid)
                    .values(thread_id=thread.id)
                )
                ni = await db.get(NewsItem, iid)
                if ni:
                    threaded_items.append({"id": ni.id, "type": "news", "title": ni.title, "summary": ni.summary_zh or ni.title})
                ev_stmt = select(MilitaryEvent).where(MilitaryEvent.source_news_id == iid)
                ev_res = await db.execute(ev_stmt)
                for ev in ev_res.scalars().all():
                    await db.execute(
                        update(MilitaryEvent).where(MilitaryEvent.id == ev.id).values(thread_id=thread.id)
                    )
                    if ev.id not in event_ids_linked:
                        event_ids_linked.add(ev.id)
                        threaded_items.append({"id": ev.id, "type": "event", "title": ev.title, "summary": ev.description or ev.title})
            
            # 4. Infer causal links within this thread
            if len(threaded_items) >= 2:
                causal_data = await ollama_client.infer_causal_links(threaded_items)
                
                # Robust list extraction
                link_list = []
                if isinstance(causal_data, list):
                    link_list = causal_data
                elif isinstance(causal_data, dict):
                    # Handle cases where LLM wraps the list in an object key
                    for key in ["items", "links", "causal_links", "data"]:
                        if isinstance(causal_data.get(key), list):
                            link_list = causal_data[key]
                            break
                
                if not link_list:
                    logger.warning(f"causal_data could not be parsed as a list: {causal_data}")

                for c in link_list:
                    if not isinstance(c, dict):
                        logger.warning(f"Skipping non-dict causal entry: {c}")
                        continue
                    try:
                        s_id = c.get("source_id")
                        t_id = c.get("target_id")
                        if s_id is None or t_id is None:
                            continue

                        conf = c.get("confidence", 0.8)
                        if not isinstance(conf, (int, float)):
                            conf = 0.8
                        conf = max(0.0, min(1.0, float(conf)))
                        link = CausalLink(
                            source_type=c.get("source_type", "news"),
                            source_id=s_id,
                            target_type=c.get("target_type", "news"),
                            target_id=t_id,
                            relation_type=c.get("relation", "caused"),
                            confidence=conf,
                        )
                        db.add(link)
                    except Exception as ce:
                        logger.warning(f"Failed to save causal link: {ce}")

            count += 1
            logger.info(f"Created narrative thread: {thread.title} with {len(item_ids)} items and potential causal links")
        except Exception as e:
            logger.error(f"Failed to create thread: {e}")
            continue

    await db.commit()
    return count
