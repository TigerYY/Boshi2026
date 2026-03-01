from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from datetime import datetime
from typing import Optional
from models import get_db, MilitaryEvent, MilitaryUnit, ControlZone

router = APIRouter(prefix="/api/events", tags=["events"])


@router.get("")
async def list_events(
    event_type: Optional[str] = None,
    side: Optional[str] = None,
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
    confirmed_only: bool = False,
    min_severity: int = Query(1, ge=1, le=5),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(MilitaryEvent)
    filters = []
    if event_type:
        filters.append(MilitaryEvent.event_type == event_type)
    if side:
        filters.append(MilitaryEvent.side == side)
    if since:
        filters.append(MilitaryEvent.occurred_at >= since)
    if until:
        filters.append(MilitaryEvent.occurred_at <= until)
    if confirmed_only:
        filters.append(MilitaryEvent.confirmed == True)
    filters.append(MilitaryEvent.severity >= min_severity)

    if filters:
        stmt = stmt.where(and_(*filters))
    stmt = stmt.order_by(MilitaryEvent.occurred_at.desc()).limit(500)
    result = await db.execute(stmt)
    items = result.scalars().all()
    return [_serialize_event(e) for e in items]


@router.get("/geojson")
async def events_geojson(
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
    db: AsyncSession = Depends(get_db),
):
    """Return events as GeoJSON FeatureCollection for Leaflet."""
    stmt = select(MilitaryEvent).where(
        MilitaryEvent.lat.isnot(None), MilitaryEvent.lon.isnot(None)
    )
    if since:
        stmt = stmt.where(MilitaryEvent.occurred_at >= since)
    if until:
        stmt = stmt.where(MilitaryEvent.occurred_at <= until)
    stmt = stmt.order_by(MilitaryEvent.occurred_at.desc()).limit(1000)
    result = await db.execute(stmt)
    events = result.scalars().all()

    features = []
    for e in events:
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [e.lon, e.lat]},
            "properties": _serialize_event(e),
        })
    return {"type": "FeatureCollection", "features": features}


def _serialize_event(e: MilitaryEvent) -> dict:
    return {
        "id": e.id,
        "event_type": e.event_type,
        "title": e.title,
        "description": e.description,
        "lat": e.lat,
        "lon": e.lon,
        "location_name": e.location_name,
        "occurred_at": e.occurred_at.isoformat() if e.occurred_at else None,
        "side": e.side,
        "confirmed": e.confirmed,
        "severity": e.severity,
        "casualties": e.casualties,
        "source_news_id": e.source_news_id,
    }


# ── Units ──────────────────────────────────────────────────────────────────

units_router = APIRouter(prefix="/api/units", tags=["units"])


@units_router.get("")
async def list_units(
    side: Optional[str] = None,
    unit_type: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(MilitaryUnit)
    if side:
        stmt = stmt.where(MilitaryUnit.side == side)
    if unit_type:
        stmt = stmt.where(MilitaryUnit.unit_type == unit_type)
    result = await db.execute(stmt)
    units = result.scalars().all()
    return [_serialize_unit(u) for u in units]


@units_router.get("/geojson")
async def units_geojson(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(MilitaryUnit).where(
            MilitaryUnit.lat.isnot(None), MilitaryUnit.lon.isnot(None)
        )
    )
    units = result.scalars().all()
    features = []
    for u in units:
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [u.lon, u.lat]},
            "properties": _serialize_unit(u),
        })
    return {"type": "FeatureCollection", "features": features}


def _serialize_unit(u: MilitaryUnit) -> dict:
    return {
        "id": u.id,
        "name": u.name,
        "unit_type": u.unit_type,
        "side": u.side,
        "lat": u.lat,
        "lon": u.lon,
        "location_name": u.location_name,
        "status": u.status,
        "updated_at": u.updated_at.isoformat() if u.updated_at else None,
        "extra": u.extra or {},
    }


# ── Control Zones ──────────────────────────────────────────────────────────

zones_router = APIRouter(prefix="/api/zones", tags=["zones"])


@zones_router.get("")
async def list_zones(
    zone_type: Optional[str] = None,
    side: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(ControlZone)
    if zone_type:
        stmt = stmt.where(ControlZone.zone_type == zone_type)
    if side:
        stmt = stmt.where(ControlZone.side == side)
    result = await db.execute(stmt)
    zones = result.scalars().all()
    return [_serialize_zone(z) for z in zones]


@zones_router.get("/geojson")
async def zones_geojson(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ControlZone))
    zones = result.scalars().all()
    features = []
    for z in zones:
        if z.geojson:
            features.append({
                "type": "Feature",
                "geometry": z.geojson,
                "properties": _serialize_zone(z),
            })
    return {"type": "FeatureCollection", "features": features}


def _serialize_zone(z: ControlZone) -> dict:
    return {
        "id": z.id,
        "name": z.name,
        "zone_type": z.zone_type,
        "side": z.side,
        "valid_from": z.valid_from.isoformat() if z.valid_from else None,
        "valid_to": z.valid_to.isoformat() if z.valid_to else None,
    }
