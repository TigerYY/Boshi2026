"""Timeline aggregation API: daily news/event counts for the heatmap without pulling full lists."""
import hashlib

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from datetime import datetime, timezone, date
from typing import Optional

from models import get_db
from ._utils import iso_utc

router = APIRouter(prefix="/api/timeline", tags=["timeline"])


def _to_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


@router.get("/density")
async def get_timeline_density(
    since: Optional[datetime] = Query(None, description="Range start (inclusive calendar day in UTC)"),
    until: Optional[datetime] = Query(None, description="Range end (inclusive calendar day in UTC)"),
    db: AsyncSession = Depends(get_db),
):
    """
    Per-day counts in [since_date, until_date] using UTC calendar days.
    News: date(COALESCE(published_at, fetched_at)) so采集入库日可计入。
    """
    if not since or not until:
        return {"days": [], "meta": {"error": "since_and_until_required"}}

    since_u = _to_utc(since)
    until_u = _to_utc(until)
    if until_u < since_u:
        since_u, until_u = until_u, since_u

    since_d: date = since_u.date()
    until_d: date = until_u.date()
    since_str = since_d.isoformat()
    until_str = until_d.isoformat()

    news_sql = text("""
        SELECT
            date(COALESCE(published_at, fetched_at)) AS d,
            COUNT(*) AS cnt,
            SUM(CASE WHEN published_at IS NULL THEN 1 ELSE 0 END) AS fetched_fallback
        FROM news
        WHERE (published_at IS NOT NULL OR fetched_at IS NOT NULL)
          AND date(COALESCE(published_at, fetched_at)) >= :since_d
          AND date(COALESCE(published_at, fetched_at)) <= :until_d
        GROUP BY d
    """)
    events_sql = text("""
        SELECT date(occurred_at) AS d, COUNT(*) AS cnt, COALESCE(SUM(severity), 0) AS severity_sum
        FROM events
        WHERE date(occurred_at) >= :since_d
          AND date(occurred_at) <= :until_d
        GROUP BY d
    """)
    params = {"since_d": since_str, "until_d": until_str}

    news_result = await db.execute(news_sql, params)
    news_rows = {}
    total_fetched_fallback = 0
    for row in news_result:
        news_rows[row.d] = {
            "cnt": row.cnt,
            "fetched_fallback": int(row.fetched_fallback or 0),
        }
        total_fetched_fallback += int(row.fetched_fallback or 0)

    events_result = await db.execute(events_sql, params)
    events_rows = {}
    for row in events_result:
        events_rows[row.d] = {"count": row.cnt, "severity_sum": row.severity_sum or 0}

    all_days = sorted(set(news_rows.keys()) | set(events_rows.keys()))
    days = [
        {
            "date": d,
            "news_count": news_rows.get(d, {}).get("cnt", 0),
            "news_fetched_fallback": news_rows.get(d, {}).get("fetched_fallback", 0),
            "event_count": events_rows.get(d, {}).get("count", 0),
            "event_severity_sum": events_rows.get(d, {}).get("severity_sum", 0),
        }
        for d in all_days
    ]

    total_news = sum(v["cnt"] for v in news_rows.values())
    total_events = sum(v["count"] for v in events_rows.values())
    calendar_span = (until_d - since_d).days + 1
    sum_news_days = sum(d["news_count"] for d in days)
    sum_event_days = sum(d["event_count"] for d in days)
    window_sig_raw = f"{since_str}|{until_str}"
    window_signature = hashlib.sha256(window_sig_raw.encode()).hexdigest()[:24]

    return {
        "days": days,
        "meta": {
            "requested_since": iso_utc(since_u),
            "requested_until": iso_utc(until_u),
            "effective_since_date": since_str,
            "effective_until_date": until_str,
            "calendar_span_days": calendar_span,
            "matched_day_count": len(all_days),
            "total_news_rows": total_news,
            "total_event_rows": total_events,
            "total_news_fetched_fallback": total_fetched_fallback,
            "timezone_basis": "UTC",
            "window_signature": window_signature,
            "window_signature_plain": window_sig_raw,
            "sum_news_count_days": sum_news_days,
            "sum_event_count_days": sum_event_days,
            "sums_consistent": sum_news_days == total_news and sum_event_days == total_events,
        },
    }
