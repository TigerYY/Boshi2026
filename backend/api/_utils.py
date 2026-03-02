"""Shared serialization helpers for API routers."""
from datetime import datetime, timezone


def iso_utc(dt: datetime | None) -> str | None:
    """Serialize a datetime to ISO-8601 with a UTC timezone suffix.

    SQLite stores datetimes as timezone-naive strings (Python interprets them
    as naive UTC datetimes).  Without the +00:00 suffix, JavaScript's
    new Date() parses them as *local* time, producing an 8-hour offset for
    UTC+8 users.  This helper always attaches the timezone so browsers parse
    the value correctly.
    """
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()
