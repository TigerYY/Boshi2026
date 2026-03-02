"""Process raw articles: persist to DB and run Ollama analysis."""
import logging
from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import NewsItem, MilitaryEvent, ScraperStatus
from scrapers.base import RawArticle
from . import ollama_client

logger = logging.getLogger(__name__)

MIDDLE_EAST_BOUNDS = {
    "lat_min": 10.0, "lat_max": 43.0,
    "lon_min": 25.0, "lon_max": 65.0,
}

IRAN_US_KEYWORDS = [
    "iran", "persian gulf", "hormuz", "tehran", "oman sea", "irgc",
    "revolutionary guard", "centcom", "us military", "pentagon",
    "carrier", "strike group", "missile", "drone", "airstrike",
    "houthi", "hezbollah", "hamas", "iraq militia", "proxy",
    "sanction", "nuclear", "enrichment", "warship", "f-35", "f-22",
    "b-52", "patriot", "iron dome", "ballistic",
]


def is_relevant(title: str, content: str) -> bool:
    combined = (title + " " + content).lower()
    return any(kw in combined for kw in IRAN_US_KEYWORDS)


def _in_middle_east(lat: float, lon: float) -> bool:
    b = MIDDLE_EAST_BOUNDS
    return b["lat_min"] <= lat <= b["lat_max"] and b["lon_min"] <= lon <= b["lon_max"]


async def save_raw_articles(
    articles: list[RawArticle],
    db: AsyncSession,
    source_id: str,
) -> list[NewsItem]:
    """Deduplicate by URL and save new articles. Returns newly saved items."""
    saved = []
    for art in articles:
        # Check duplicate
        exists = await db.scalar(select(NewsItem).where(NewsItem.url == art.url))
        if exists:
            continue

        # Relevance filter
        if not is_relevant(art.title, art.content):
            continue

        item = NewsItem(
            source=art.source,
            source_tier=art.source_tier,
            title=art.title,
            url=art.url,
            content=art.content,
            published_at=art.published_at,
            image_url=art.image_url,
            processed=False,
        )
        db.add(item)
        saved.append(item)

    await db.commit()
    # Refresh to get IDs
    for item in saved:
        await db.refresh(item)

    # Update scraper status
    status = await db.scalar(
        select(ScraperStatus).where(ScraperStatus.source_id == source_id)
    )
    if status:
        status.last_success = datetime.now(timezone.utc)
        status.last_count = len(saved)
        await db.commit()

    logger.info(f"[{source_id}] saved {len(saved)} new articles")
    return saved


async def process_with_ai(news_item: NewsItem, db: AsyncSession) -> None:
    """Run Ollama analysis on a single news item."""
    result = await ollama_client.summarize_and_classify(
        title=news_item.title,
        content=news_item.content or "",
    )

    news_item.summary_zh = result["summary_zh"]
    news_item.category = result["category"]
    news_item.confidence = result["confidence"]
    news_item.is_breaking = result["is_breaking"]

    # Filter locations to Middle East
    valid_locs = [
        loc for loc in result.get("locations", [])
        if _in_middle_east(loc.get("lat", 0), loc.get("lon", 0))
    ]
    news_item.locations = valid_locs
    news_item.processed = True

    # Optionally analyze image
    if news_item.image_url and result.get("is_breaking"):
        news_item.image_analysis = await ollama_client.analyze_image(news_item.image_url)

    await db.commit()

    # Auto-create military event for confirmed military actions
    if result["category"] in ("airstrike", "missile", "naval", "land") and valid_locs:
        loc = valid_locs[0]
        event = MilitaryEvent(
            event_type=result["category"],
            title=news_item.title,
            description=result["summary_zh"],
            lat=loc["lat"],
            lon=loc["lon"],
            location_name=loc["name"],
            occurred_at=news_item.published_at or datetime.now(timezone.utc),
            source_news_id=news_item.id,
            confirmed=result["confidence"] >= 0.7,
            severity=3 if result["is_breaking"] else 2,
        )
        db.add(event)
        await db.commit()


async def process_pending(db: AsyncSession, limit: int = 20) -> int:
    """Process up to `limit` unprocessed news items. Returns count processed."""
    # Guard: skip the entire batch if Ollama is unreachable to avoid 30+ failed calls
    if not await ollama_client.check_ollama_health():
        logger.warning("Ollama unavailable, skipping AI processing batch")
        return 0

    # Oldest-first: prevents newer articles starving older ones when the DB grows
    result = await db.execute(
        select(NewsItem)
        .where(NewsItem.processed == False)
        .order_by(NewsItem.fetched_at.asc())
        .limit(limit)
    )
    items = result.scalars().all()
    count = 0
    for item in items:
        try:
            await process_with_ai(item, db)
            count += 1
        except Exception as e:
            logger.error(f"AI processing failed for news {item.id}: {e}")
    return count
