from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
from datetime import datetime, timezone
from typing import Optional
from models import get_db, NewsItem
from ._utils import iso_utc

router = APIRouter(prefix="/api/news", tags=["news"])


@router.get("")
async def list_news(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    category: Optional[str] = None,
    source_tier: Optional[int] = None,
    breaking_only: bool = False,
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
    q: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(NewsItem)
    filters = []
    if category:
        filters.append(NewsItem.category == category)
    if source_tier:
        filters.append(NewsItem.source_tier == source_tier)
    if breaking_only:
        filters.append(NewsItem.is_breaking == True)
    if since:
        filters.append(NewsItem.published_at >= since)
    if until:
        filters.append(NewsItem.published_at <= until)
    if q:
        filters.append(
            or_(
                NewsItem.title.ilike(f"%{q}%"),
                NewsItem.summary_zh.ilike(f"%{q}%"),
            )
        )
    if filters:
        stmt = stmt.where(and_(*filters))

    total = await db.scalar(select(func.count()).select_from(stmt.subquery()))
    stmt = stmt.order_by(NewsItem.published_at.desc()).offset((page - 1) * size).limit(size)
    result = await db.execute(stmt)
    items = result.scalars().all()

    return {
        "total": total,
        "page": page,
        "size": size,
        "items": [_serialize(n) for n in items],
    }


@router.get("/{news_id}")
async def get_news(news_id: int, db: AsyncSession = Depends(get_db)):
    item = await db.get(NewsItem, news_id)
    if not item:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Not found")
    return _serialize(item)


def _serialize(n: NewsItem) -> dict:
    return {
        "id": n.id,
        "source": n.source,
        "source_tier": n.source_tier,
        "title": n.title,
        "url": n.url,
        "summary_zh": n.summary_zh,
        "category": n.category,
        "confidence": n.confidence,
        "locations": n.locations or [],
        "image_url": n.image_url,
        "image_analysis": n.image_analysis,
        "is_breaking": n.is_breaking,
        "published_at": iso_utc(n.published_at),
        "fetched_at": iso_utc(n.fetched_at),
        "processed": n.processed,
    }
