"""APScheduler-based background task scheduler with WebSocket broadcast."""
import asyncio
import logging
from datetime import datetime, timezone
from typing import Any
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy import select

from models import AsyncSessionLocal, ScraperStatus
from scrapers.sources import SCRAPER_MAP
from pipeline.processor import save_raw_articles, process_pending
from pipeline.ollama_client import generate_daily_summary

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler(timezone="UTC")

# ── WebSocket Connection Manager ───────────────────────────────────────────

class ConnectionManager:
    def __init__(self):
        self.active: set = set()

    async def connect(self, ws):
        await ws.accept()
        self.active.add(ws)

    def disconnect(self, ws):
        self.active.discard(ws)

    async def broadcast(self, message: dict):
        if not self.active:
            return
        import json
        data = json.dumps(message, ensure_ascii=False, default=str)
        dead = set()
        for ws in list(self.active):
            try:
                await ws.send_text(data)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self.active.discard(ws)


ws_manager = ConnectionManager()


# ── Individual source scrape job ───────────────────────────────────────────

async def run_scraper(source_id: str):
    scraper = SCRAPER_MAP.get(source_id)
    if not scraper:
        return

    async with AsyncSessionLocal() as db:
        # Check if enabled
        status = await db.scalar(
            select(ScraperStatus).where(ScraperStatus.source_id == source_id)
        )
        if status and not status.enabled:
            return

        # Update last_run
        if status:
            status.last_run = datetime.now(timezone.utc)
            status.error_msg = None
            await db.commit()

    # Fetch
    articles = await scraper.fetch()
    if not articles:
        return

    async with AsyncSessionLocal() as db:
        status = await db.scalar(
            select(ScraperStatus).where(ScraperStatus.source_id == source_id)
        )
        try:
            saved = await save_raw_articles(articles, db, source_id)
            if status:
                status.last_success = datetime.now(timezone.utc)
                status.last_count = len(saved)
                await db.commit()

            if saved:
                await ws_manager.broadcast({
                    "type": "new_articles",
                    "source": source_id,
                    "count": len(saved),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })
        except Exception as e:
            logger.error(f"Scraper {source_id} error: {e}")
            if status:
                status.error_msg = str(e)
                await db.commit()


async def run_all_scrapers():
    """Run all enabled scrapers in parallel."""
    tasks = [run_scraper(sid) for sid in SCRAPER_MAP]
    await asyncio.gather(*tasks, return_exceptions=True)

    # Process with AI
    async with AsyncSessionLocal() as db:
        count = await process_pending(db, limit=30)
    if count:
        await ws_manager.broadcast({
            "type": "ai_processed",
            "count": count,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })


async def run_daily_analysis():
    """Generate daily battlefield analysis report."""
    from models.schemas import NewsItem, MilitaryEvent, AnalysisReport
    async with AsyncSessionLocal() as db:
        # Gather last 24h news summaries
        from datetime import timedelta
        since = datetime.now(timezone.utc) - timedelta(hours=24)
        news_result = await db.execute(
            select(NewsItem)
            .where(NewsItem.processed == True, NewsItem.published_at >= since)
            .order_by(NewsItem.published_at.desc())
            .limit(50)
        )
        news_items = news_result.scalars().all()

        events_result = await db.execute(
            select(MilitaryEvent)
            .where(MilitaryEvent.occurred_at >= since)
            .order_by(MilitaryEvent.occurred_at.desc())
            .limit(30)
        )
        events = events_result.scalars().all()

        news_text = "\n".join(
            f"[{n.source}] {n.title}: {n.summary_zh or n.title}" for n in news_items
        )
        events_text = "\n".join(
            f"[{e.event_type}] {e.title} @ {e.location_name}" for e in events
        )

        result = await generate_daily_summary(events_text, news_text)

        report = AnalysisReport(
            report_type="daily_summary",
            content=result.get("summary", ""),
            period_start=since,
            period_end=datetime.now(timezone.utc),
            intensity_score=result.get("intensity_score", 5.0),
            hotspots=result.get("hotspots", []),
        )
        db.add(report)
        await db.commit()

        await ws_manager.broadcast({
            "type": "analysis_updated",
            "report_type": "daily_summary",
            "intensity_score": result.get("intensity_score", 5.0),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })


def setup_scheduler():
    """Register all scheduled jobs."""
    # Run all scrapers every 15 min
    scheduler.add_job(
        run_all_scrapers,
        trigger=IntervalTrigger(minutes=15),
        id="all_scrapers",
        replace_existing=True,
        misfire_grace_time=60,
    )
    # Daily analysis at 06:00 UTC
    from apscheduler.triggers.cron import CronTrigger
    scheduler.add_job(
        run_daily_analysis,
        trigger=CronTrigger(hour=6, minute=0, timezone="UTC"),
        id="daily_analysis",
        replace_existing=True,
    )
