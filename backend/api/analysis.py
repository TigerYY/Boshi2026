from fastapi import APIRouter, Depends, Query, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from datetime import datetime, timezone, timedelta
from typing import Optional
from models import get_db, AnalysisReport, MilitaryEvent, NewsItem
from pipeline.ollama_client import generate_daily_summary, health_check

router = APIRouter(prefix="/api/analysis", tags=["analysis"])


@router.get("/latest")
async def get_latest_report(
    report_type: str = "daily_summary",
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AnalysisReport)
        .where(AnalysisReport.report_type == report_type)
        .order_by(AnalysisReport.generated_at.desc())
        .limit(1)
    )
    report = result.scalar_one_or_none()
    if not report:
        return {"error": "no report available yet"}
    return _serialize(report)


@router.get("/history")
async def report_history(
    limit: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(AnalysisReport)
        .where(AnalysisReport.report_type == "daily_summary")
        .order_by(AnalysisReport.generated_at.desc())
        .limit(limit)
    )
    reports = result.scalars().all()
    return [_serialize(r) for r in reports]


@router.post("/generate")
async def trigger_analysis(
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Manually trigger AI analysis generation."""
    async def _run():
        since = datetime.now(timezone.utc) - timedelta(hours=24)
        async with __import__("models", fromlist=["AsyncSessionLocal"]).AsyncSessionLocal() as session:
            news_result = await session.execute(
                select(NewsItem)
                .where(NewsItem.processed == True, NewsItem.published_at >= since)
                .order_by(NewsItem.published_at.desc())
                .limit(50)
            )
            news_items = news_result.scalars().all()
            events_result = await session.execute(
                select(MilitaryEvent)
                .where(MilitaryEvent.occurred_at >= since)
                .order_by(MilitaryEvent.occurred_at.desc())
                .limit(30)
            )
            events = events_result.scalars().all()

            news_text = "\n".join(f"[{n.source}] {n.title}: {n.summary_zh or ''}" for n in news_items)
            events_text = "\n".join(f"[{e.event_type}] {e.title} @ {e.location_name}" for e in events)

            result = await generate_daily_summary(events_text, news_text)
            report = AnalysisReport(
                report_type="daily_summary",
                content=result.get("summary", ""),
                period_start=since,
                period_end=datetime.now(timezone.utc),
                intensity_score=result.get("intensity_score", 5.0),
                hotspots=result.get("hotspots", []),
            )
            session.add(report)
            await session.commit()

    background_tasks.add_task(_run)
    return {"status": "Analysis generation started in background"}


@router.get("/intensity")
async def intensity_trend(
    days: int = Query(7, ge=1, le=30),
    db: AsyncSession = Depends(get_db),
):
    """Return daily event counts for intensity chart."""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    result = await db.execute(
        select(MilitaryEvent)
        .where(MilitaryEvent.occurred_at >= since)
        .order_by(MilitaryEvent.occurred_at)
    )
    events = result.scalars().all()

    # Group by day
    day_counts: dict = {}
    type_counts: dict = {}
    for e in events:
        if not e.occurred_at:
            continue
        day = e.occurred_at.strftime("%Y-%m-%d")
        day_counts[day] = day_counts.get(day, 0) + e.severity
        type_counts[e.event_type] = type_counts.get(e.event_type, 0) + 1

    return {
        "daily_intensity": [{"date": k, "score": v} for k, v in sorted(day_counts.items())],
        "event_type_dist": [{"type": k, "count": v} for k, v in type_counts.items()],
    }


@router.get("/ollama/health")
async def ollama_health():
    ok = await health_check()
    return {"status": "ok" if ok else "unavailable", "model": "qwen3-vl:8b"}


def _serialize(r: AnalysisReport) -> dict:
    return {
        "id": r.id,
        "report_type": r.report_type,
        "content": r.content,
        "generated_at": r.generated_at.isoformat() if r.generated_at else None,
        "period_start": r.period_start.isoformat() if r.period_start else None,
        "period_end": r.period_end.isoformat() if r.period_end else None,
        "intensity_score": r.intensity_score,
        "hotspots": r.hotspots or [],
    }
