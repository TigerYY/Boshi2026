"""Timeline aggregation API: daily news/event counts for the heatmap without pulling full lists."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from datetime import datetime
from typing import Optional

from models import get_db

router = APIRouter(prefix="/api/timeline", tags=["timeline"])


@router.get("/density")
async def get_timeline_density(
    since: Optional[datetime] = Query(None, description="Start of range (inclusive)"),
    until: Optional[datetime] = Query(None, description="End of range (inclusive)"),
    db: AsyncSession = Depends(get_db),
):
    """
    Return per-day counts for news and events in [since, until].
    Used by the frontend timeline heatmap to avoid pulling full item lists.
    """
    if not since or not until:
        return {"days": []}

    # SQLite: date(column) gives YYYY-MM-DD
    news_sql = text("""
        SELECT date(published_at) AS d, COUNT(*) AS cnt
        FROM news
        WHERE published_at >= :since AND published_at <= :until
        GROUP BY d
    """)
    events_sql = text("""
        SELECT date(occurred_at) AS d, COUNT(*) AS cnt, COALESCE(SUM(severity), 0) AS severity_sum
        FROM events
        WHERE occurred_at >= :since AND occurred_at <= :until
        GROUP BY d
    """)
    params = {"since": since, "until": until}

    news_result = await db.execute(news_sql, params)
    news_rows = {row.d: row.cnt for row in news_result}

    events_result = await db.execute(events_sql, params)
    events_rows = {}
    for row in events_result:
        events_rows[row.d] = {"count": row.cnt, "severity_sum": row.severity_sum or 0}

    all_days = sorted(set(news_rows.keys()) | set(events_rows.keys()))
    days = [
        {
            "date": d,
            "news_count": news_rows.get(d, 0),
            "event_count": events_rows.get(d, {}).get("count", 0),
            "event_severity_sum": events_rows.get(d, {}).get("severity_sum", 0),
        }
        for d in all_days
    ]
    return {"days": days}
