from fastapi import APIRouter, Depends, Query, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from datetime import datetime, timezone, timedelta
from typing import Optional
from models import get_db, AnalysisReport, MilitaryEvent, NewsItem
from pipeline.ollama_client import generate_daily_summary, health_check
import math
from ._utils import iso_utc

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

            def _fmt_dt(dt: datetime | None) -> str:
                if not dt: return "[未知时间]"
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return (dt + timedelta(hours=8)).strftime("[%m-%d %H:%M]")

            news_text = "\n".join(f"{_fmt_dt(n.published_at)} [{n.source}] {n.title}: {n.summary_zh or ''}" for n in news_items)
            events_text = "\n".join(f"{_fmt_dt(e.occurred_at)} [{e.event_type}] {e.title} @ {e.location_name}" for e in events)

            result = await generate_daily_summary(events_text, news_text)
            if result is None:
                return  # no input data, skip writing hollow report
            report = AnalysisReport(
                report_type="daily_summary",
                content=result.get("summary", ""),
                period_start=since,
                period_end=datetime.now(timezone.utc),
                intensity_score=result.get("intensity_score", 5.0),
                hotspots=result.get("hotspots", []),
                key_developments=result.get("key_developments", []),
                outlook=result.get("outlook", ""),
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
    """Return daily intensity scores for the trend chart.

    Primary source: AnalysisReport.intensity_score (one data-point per report).
    Supplementary: MilitaryEvent severity sums, added on top of the report score
    for days that have events.  This guarantees a non-empty result even when
    no MilitaryEvents exist in the window.
    """
    since = datetime.now(timezone.utc) - timedelta(days=days)

    # ── AnalysisReport intensity scores ────────────────────────────────────
    reports_result = await db.execute(
        select(AnalysisReport)
        .where(
            AnalysisReport.report_type == "daily_summary",
            AnalysisReport.generated_at >= since,
        )
        .order_by(AnalysisReport.generated_at)
    )
    reports = reports_result.scalars().all()

    # One score per day — keep the latest report if multiple exist on the same day
    day_score: dict[str, float] = {}
    for r in reports:
        if not r.generated_at:
            continue
        day = r.generated_at.strftime("%Y-%m-%d")
        day_score[day] = r.intensity_score or 5.0

    # ── MilitaryEvent severity sums ─────────────────────────────────────────
    events_result = await db.execute(
        select(MilitaryEvent)
        .where(MilitaryEvent.occurred_at >= since)
        .order_by(MilitaryEvent.occurred_at)
    )
    events = events_result.scalars().all()

    type_counts: dict = {}
    daily_severity_sum: dict[str, float] = {}
    for e in events:
        if not e.occurred_at:
            continue
        day = e.occurred_at.strftime("%Y-%m-%d")
        daily_severity_sum[day] = daily_severity_sum.get(day, 0.0) + (e.severity or 0)
        type_counts[e.event_type] = type_counts.get(e.event_type, 0) + 1

    final_day_score: dict[str, float] = {}
    all_days = set(list(day_score.keys()) + list(daily_severity_sum.keys()))
    if not all_days:
        final_day_score[datetime.now(timezone.utc).strftime("%Y-%m-%d")] = 3.0

    for day in all_days:
        ai_score = day_score.get(day, 3.0) 
        sev_sum = daily_severity_sum.get(day, 0.0)
        # 将事件总严重程度通过指数收敛函数映射至 0-10 分
        event_score = 10.0 * (1.0 - math.exp(-sev_sum / 100.0))
        
        # 融合AI生成的总结分数与实际事件堆叠分数
        if day in day_score:
            blended = (ai_score * 0.7) + (event_score * 0.3)
        else:
            blended = (ai_score * 0.2) + (event_score * 0.8)
            blended = max(blended, 1.0)
            
        final_day_score[day] = min(10.0, blended)

    return {
        "daily_intensity": [{"date": k, "score": round(v, 1)} for k, v in sorted(final_day_score.items())],
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
        "generated_at": iso_utc(r.generated_at),
        "period_start": iso_utc(r.period_start),
        "period_end": iso_utc(r.period_end),
        "intensity_score": r.intensity_score,
        "hotspots": r.hotspots or [],
        "key_developments": r.key_developments or [],
        "outlook": r.outlook or "",
    }
