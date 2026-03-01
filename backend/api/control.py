"""Update control: enable/disable sources, change intervals, manual refresh."""
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from datetime import datetime, timezone
from models import get_db, ScraperStatus
from scrapers.sources import SCRAPER_MAP

router = APIRouter(prefix="/api/control", tags=["control"])


class SourceUpdate(BaseModel):
    enabled: bool | None = None
    auto_interval_minutes: int | None = None


@router.get("/sources")
async def list_sources(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ScraperStatus).order_by(ScraperStatus.source_id))
    sources = result.scalars().all()
    return [_serialize(s) for s in sources]


@router.patch("/sources/{source_id}")
async def update_source(
    source_id: str,
    body: SourceUpdate,
    db: AsyncSession = Depends(get_db),
):
    status = await db.scalar(select(ScraperStatus).where(ScraperStatus.source_id == source_id))
    if not status:
        raise HTTPException(status_code=404, detail="Source not found")
    if body.enabled is not None:
        status.enabled = body.enabled
    if body.auto_interval_minutes is not None:
        status.auto_interval_minutes = max(1, body.auto_interval_minutes)
    await db.commit()
    return _serialize(status)


@router.post("/refresh")
async def manual_refresh(
    background_tasks: BackgroundTasks,
    source_id: str | None = None,
):
    """Trigger immediate full-pipeline refresh: scrape → AI process → generate report."""
    from scheduler import run_scraper, run_all_scrapers, run_daily_analysis, ws_manager
    from pipeline.processor import process_pending
    from models import AsyncSessionLocal

    async def _run():
        # Step 1: scrape
        if source_id:
            await run_scraper(source_id)
        else:
            await run_all_scrapers()

        # Step 2: AI process individual news items
        async with AsyncSessionLocal() as db:
            count = await process_pending(db, limit=50)

        # Step 3: generate / refresh battlefield analysis report
        await run_daily_analysis()

        await ws_manager.broadcast({
            "type": "manual_refresh_done",
            "ai_processed": count,
            "analysis_updated": True,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

    background_tasks.add_task(_run)
    return {"status": "refresh started", "source_id": source_id or "all"}


@router.get("/status")
async def system_status(db: AsyncSession = Depends(get_db)):
    from models import NewsItem, MilitaryEvent
    from sqlalchemy import func

    news_count = await db.scalar(select(func.count(NewsItem.id)))
    events_count = await db.scalar(select(func.count(MilitaryEvent.id)))
    unprocessed = await db.scalar(
        select(func.count(NewsItem.id)).where(NewsItem.processed == False)
    )
    return {
        "news_total": news_count,
        "events_total": events_count,
        "news_unprocessed": unprocessed,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def _serialize(s: ScraperStatus) -> dict:
    return {
        "source_id": s.source_id,
        "source_name": s.source_name,
        "enabled": s.enabled,
        "last_run": s.last_run.isoformat() if s.last_run else None,
        "last_success": s.last_success.isoformat() if s.last_success else None,
        "last_count": s.last_count,
        "error_msg": s.error_msg,
        "auto_interval_minutes": s.auto_interval_minutes,
    }
