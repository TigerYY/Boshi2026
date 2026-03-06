"""Live flight and ship tracking endpoints.

Aircraft data: api.adsb.lol (primary, free, no API key, no rate limits)
  Fallback: OpenSky Network (anonymous, rate-limited ~400 req/day)
  Final fallback: demo positions for key military aircraft in the region.
Ship data: demo positions for key naval assets when AISSTREAM_API_KEY is not set.
  To enable real AIS data, register at https://aisstream.io (free tier) and set
  the AISSTREAM_API_KEY environment variable.
"""
import asyncio
import os
import time
import logging
import requests as req_lib
from datetime import datetime, timedelta
from sqlalchemy import select
from models import AsyncSessionLocal, get_db
from models.schemas import FlightRecord, VesselRecord
from fastapi import APIRouter, Depends, Query

router = APIRouter(prefix="/api", tags=["live"])
logger = logging.getLogger(__name__)

CACHE_TTL = 45  # 45s: short enough to serve 1-min dynamic frontend refreshes, avoids spamming APIs

_flights_cache: dict = {"data": [], "expires_at": 0.0}
_ships_cache: dict = {"data": [], "expires_at": 0.0, "demo": True}

# ── Demo aircraft: shown when all live APIs fail ───────────────────────────
# Realistic military aircraft positions in the Middle East / Persian Gulf region

_DEMO_AIRCRAFT = [
    {"icao24": "ae1234", "callsign": "IRON99",  "origin_country": "United States",
     "lat": 24.85, "lon": 46.72, "altitude": 9144, "on_ground": False,
     "velocity": 231, "heading": 275},  # E-3 AWACS over Saudi Arabia
    {"icao24": "ae5678", "callsign": "COBRA11", "origin_country": "United States",
     "lat": 18.42, "lon": 42.68, "altitude": 7620, "on_ground": False,
     "velocity": 195, "heading": 340},  # RC-135 reconnaissance, Red Sea
    {"icao24": "ae9abc", "callsign": "SHARK71", "origin_country": "United States",
     "lat": 22.10, "lon": 59.85, "altitude": 6096, "on_ground": False,
     "velocity": 210, "heading": 315},  # P-8 Poseidon, Arabian Sea
    {"icao24": "ae3def", "callsign": "HORNET4", "origin_country": "United States",
     "lat": 26.55, "lon": 54.30, "altitude": 4572, "on_ground": False,
     "velocity": 278, "heading": 110},  # F/A-18 patrol, Persian Gulf
    {"icao24": "422f01", "callsign": "IRIAF14", "origin_country": "Iran",
     "lat": 29.62, "lon": 52.54, "altitude": 8230, "on_ground": False,
     "velocity": 310, "heading": 220},  # F-14 Tomcat, Fars Province
    {"icao24": "422f02", "callsign": "SHAHED",  "origin_country": "Iran",
     "lat": 26.88, "lon": 56.45, "altitude": 1500, "on_ground": False,
     "velocity": 65,  "heading": 180},  # Shahed drone, Strait of Hormuz
]

# ── ADS-B primary source: api.adsb.lol ────────────────────────────────────
# Free, no API key, generous rate limits; uses baro altitude (feet) + ground speed (knots)

ADSBINFO_POINTS = [
    (26.58, 56.45, 1000),  # Strait of Hormuz (core area, extended to 1000km to cover entire Gulf & Iran)
    (18.0, 42.0, 800),    # Red Sea / Yemen (extended to 800km)
    (33.0, 44.0, 800),    # Iraq / Syria / Northern ME
]
ADSBINFO_URL = "https://api.adsb.lol/v2/point/{lat}/{lon}/{dist}"

_COUNTRY_PREFIX = {
    "ae": "United States", "a0": "United States", "a1": "United States",
    "a2": "United States", "a3": "United States", "a4": "United States",
    "a5": "United States", "a6": "United States", "a7": "United States",
    "a8": "United States", "a9": "United States",
    "70": "United Kingdom", "40": "United Kingdom", "41": "United Kingdom",
    "42": "Iran", "43": "Iran",
    "71": "Saudi Arabia", "72": "Saudi Arabia",
    "89": "Israel", "8a": "Israel",
    "73": "UAE", "74": "UAE",
}


def _country_from_icao(hex24: str) -> str:
    prefix = (hex24 or "")[:2].lower()
    return _COUNTRY_PREFIX.get(prefix, "Unknown")


def _parse_adsbinfo_record(s: dict) -> dict | None:
    try:
        lat = s.get("lat")
        lon = s.get("lon")
        if lat is None or lon is None:
            return None
        alt_raw = s.get("alt_baro", 0)
        if alt_raw == "ground":
            altitude_m = 0
            on_ground = True
        else:
            altitude_m = round(float(alt_raw) * 0.3048)
            on_ground = altitude_m < 50
        return {
            "icao24": s.get("hex", ""),
            "callsign": (s.get("flight") or "UNKNOWN").strip(),
            "origin_country": _country_from_icao(s.get("hex", "")),
            "lon": round(float(lon), 5),
            "lat": round(float(lat), 5),
            "altitude": altitude_m,
            "on_ground": on_ground,
            "velocity": round(float(s.get("gs") or 0) * 0.5144),   # knots → m/s
            "heading": round(float(s.get("track") or 0)),
        }
    except Exception:
        return None


def _fetch_adsbinfo_sync() -> list:
    seen: set = set()
    result: list = []
    for lat, lon, dist in ADSBINFO_POINTS:
        try:
            url = ADSBINFO_URL.format(lat=lat, lon=lon, dist=dist)
            resp = req_lib.get(url, timeout=15, headers={"User-Agent": "BoShi2025/1.0"})
            resp.raise_for_status()
            for s in resp.json().get("ac", []):
                rec = _parse_adsbinfo_record(s)
                if rec and rec["icao24"] not in seen:
                    seen.add(rec["icao24"])
                    result.append(rec)
        except Exception as e:
            logger.warning(f"adsb.lol fetch error for ({lat},{lon}): {e}")
    logger.info(f"adsb.lol: fetched {len(result)} aircraft in region")
    return result


# ── Fallback: OpenSky Network ──────────────────────────────────────────────

OPENSKY_URL = "https://opensky-network.org/api/states/all"
_REGION = {"lamin": 10, "lomin": 32, "lamax": 42, "lomax": 68}


def _fetch_opensky_sync() -> list:
    try:
        resp = req_lib.get(OPENSKY_URL, params=_REGION, timeout=20)
        if resp.status_code == 429:
            logger.warning("OpenSky rate limited")
            return []
        resp.raise_for_status()
        states = resp.json().get("states") or []
        result = []
        for s in states:
            lon, lat = s[5], s[6]
            if lon is None or lat is None:
                continue
            result.append({
                "icao24": s[0] or "",
                "callsign": (s[1] or "").strip() or "UNKNOWN",
                "origin_country": s[2] or "",
                "lon": round(lon, 5),
                "lat": round(lat, 5),
                "altitude": round(s[7] or 0),
                "on_ground": bool(s[8]),
                "velocity": round(s[9] or 0),
                "heading": round(s[10] or 0),
            })
        logger.info(f"OpenSky: fetched {len(result)} aircraft in region")
        return result
    except Exception as e:
        logger.error(f"OpenSky fetch error: {e}")
        return []


def _fetch_flights_sync() -> list:
    """Try adsb.lol → OpenSky → demo data, in order."""
    data = _fetch_adsbinfo_sync()
    if data:
        return data
    logger.warning("adsb.lol returned no data, trying OpenSky fallback")
    data = _fetch_opensky_sync()
    if data:
        return data
    logger.warning("All live sources failed — using demo aircraft data")
    return _DEMO_AIRCRAFT


@router.get("/flights/live")
async def get_live_flights():
    now = time.time()
    if _flights_cache["expires_at"] > now:
        return {
            "aircraft": _flights_cache["data"],
            "cached": True,
            "count": len(_flights_cache["data"]),
        }
    data = await asyncio.to_thread(_fetch_flights_sync)
    _flights_cache["data"] = data
    _flights_cache["expires_at"] = now + CACHE_TTL
    return {"aircraft": data, "cached": False, "count": len(data)}


# ── AIS ship tracking ───────────────────────────────────────────────────────
# Demo data: realistic last-known positions for major naval assets in the region.
# Side is one of: "US", "IR" (Iran/IRGC), "civilian"

_DEMO_SHIPS = [
    # US Navy — 5th Fleet / CENTCOM
    {"mmsi": "338000001", "name": "USS DWIGHT D. EISENHOWER", "ship_type": "carrier",
     "flag": "US", "lat": 25.82, "lon": 56.34, "speed": 12.4, "heading": 275, "status": "underway",
     "side": "US"},
    {"mmsi": "338000002", "name": "USS COLE (DDG-67)", "ship_type": "destroyer",
     "flag": "US", "lat": 24.50, "lon": 57.21, "speed": 8.2, "heading": 310, "status": "underway",
     "side": "US"},
    {"mmsi": "338000003", "name": "USS BATAAN (LHD-5)", "ship_type": "amphibious",
     "flag": "US", "lat": 26.15, "lon": 55.82, "speed": 0.0, "heading": 180, "status": "anchored",
     "side": "US"},
    {"mmsi": "338000010", "name": "USS LEYTE GULF (CG-55)", "ship_type": "cruiser",
     "flag": "US", "lat": 26.22, "lon": 50.62, "speed": 0.0, "heading": 10, "status": "anchored",
     "side": "US"},
    {"mmsi": "338000011", "name": "USS GRAVELY (DDG-107)", "ship_type": "destroyer",
     "flag": "US", "lat": 20.22, "lon": 41.18, "speed": 14.3, "heading": 155, "status": "underway",
     "side": "US"},
    # IRGC / Iranian Navy
    {"mmsi": "422000001", "name": "IRGC 快艇 编队 1", "ship_type": "patrol_vessel",
     "flag": "IR", "lat": 27.18, "lon": 56.28, "speed": 22.0, "heading": 135, "status": "underway",
     "side": "IR"},
    {"mmsi": "422000002", "name": "IRGC 快艇 编队 2", "ship_type": "patrol_vessel",
     "flag": "IR", "lat": 26.83, "lon": 55.96, "speed": 18.5, "heading": 220, "status": "underway",
     "side": "IR"},
    {"mmsi": "422000003", "name": "萨汉德护卫舰", "ship_type": "frigate",
     "flag": "IR", "lat": 27.35, "lon": 56.45, "speed": 5.1, "heading": 90, "status": "underway",
     "side": "IR"},
    {"mmsi": "422000004", "name": "法塔赫潜艇", "ship_type": "submarine",
     "flag": "IR", "lat": 27.12, "lon": 58.05, "speed": 4.0, "heading": 200, "status": "underway",
     "side": "IR"},
    # Commercial tankers
    {"mmsi": "370000001", "name": "SUEZ FORTUNE", "ship_type": "tanker",
     "flag": "PA", "lat": 24.82, "lon": 56.72, "speed": 14.2, "heading": 60, "status": "underway",
     "side": "civilian"},
    {"mmsi": "370000002", "name": "GULF NAVIGATOR", "ship_type": "tanker",
     "flag": "PA", "lat": 27.02, "lon": 53.52, "speed": 11.8, "heading": 180, "status": "underway",
     "side": "civilian"},
    {"mmsi": "370000003", "name": "HORMUZ SPIRIT", "ship_type": "tanker",
     "flag": "MH", "lat": 26.32, "lon": 54.12, "speed": 13.5, "heading": 270, "status": "underway",
     "side": "civilian"},
    # Houthi-threatened Red Sea
    {"mmsi": "370000010", "name": "MSC ARIES", "ship_type": "container",
     "flag": "MH", "lat": 15.32, "lon": 43.12, "speed": 0.0, "heading": 0, "status": "seized",
     "side": "civilian"},
    # Additional high-density demo ships around Strait of Hormuz
    {"mmsi": "370000011", "name": "FRONT ALTAIR", "ship_type": "tanker",
     "flag": "MH", "lat": 25.42, "lon": 57.32, "speed": 13.1, "heading": 110, "status": "underway",
     "side": "civilian"},
    {"mmsi": "370000012", "name": "KOKUKA COURAGEOUS", "ship_type": "tanker",
     "flag": "PA", "lat": 25.22, "lon": 57.50, "speed": 12.0, "heading": 125, "status": "underway",
     "side": "civilian"},
    {"mmsi": "422000005", "name": "IRGC 快速突击艇", "ship_type": "patrol_vessel",
     "flag": "IR", "lat": 26.65, "lon": 56.40, "speed": 35.0, "heading": 210, "status": "underway",
     "side": "IR"},
    {"mmsi": "422000006", "name": "马克兰号前沿基地舰", "ship_type": "warship",
     "flag": "IR", "lat": 25.10, "lon": 60.55, "speed": 8.5, "heading": 260, "status": "underway",
     "side": "IR"},
    {"mmsi": "338000012", "name": "USCGC MAUI", "ship_type": "patrol_vessel",
     "flag": "US", "lat": 26.50, "lon": 56.35, "speed": 18.0, "heading": 85, "status": "underway",
     "side": "US"},
]


import websockets
import json

_ais_ws_task = None
_ais_state = {}
_KNOWN_MMSI = {s["mmsi"]: s for s in _DEMO_SHIPS}

async def _ais_listener_loop(api_key: str):
    uri = "wss://stream.aisstream.io/v0/stream"
    subscribe_message = {
        "APIKey": api_key,
        "BoundingBoxes": [
            [[22.0, 48.0], [30.0, 60.0]],  # Persian Gulf & Strait of Hormuz
            [[12.0, 42.0], [20.0, 46.0]]   # Red Sea & Gulf of Aden
        ],
        "FilterMessageTypes": ["PositionReport"]
    }
    
    while True:
        try:
            async with websockets.connect(uri) as websocket:
                logger.info("Connected to AISStream WebSocket")
                await websocket.send(json.dumps(subscribe_message))
                async for message in websocket:
                    msg = json.loads(message)
                    if msg.get("MessageType") == "PositionReport":
                        report = msg["Message"]["PositionReport"]
                        meta = msg.get("MetaData", {})
                        mmsi = str(meta.get("MMSI", ""))
                        if not mmsi:
                            continue
                            
                        # Format mapping
                        if mmsi in _KNOWN_MMSI:
                            # Military / high-value targets preserve their rich metadata
                            base = _KNOWN_MMSI[mmsi].copy()
                            base["lat"] = round(report["Latitude"], 5)
                            base["lon"] = round(report["Longitude"], 5)
                            base["speed"] = round(report.get("Sog", 0), 1)
                            base["heading"] = round(report.get("Cog", 0))
                            _ais_state[mmsi] = base
                        else:
                            # Generic commercial ship
                            name = (meta.get("ShipName") or "").strip()
                            _ais_state[mmsi] = {
                                "mmsi": mmsi,
                                "name": name or f"Vessel-{mmsi}",
                                "ship_type": "cargo",
                                "flag": "Unknown",
                                "lat": round(report["Latitude"], 5),
                                "lon": round(report["Longitude"], 5),
                                "speed": round(report.get("Sog", 0), 1),
                                "heading": round(report.get("Cog", 0)),
                                "status": "underway",
                                "side": "civilian"
                            }
                            
                        # Evict oldest to keep memory stable (1500 ships max)
                        if len(_ais_state) > 1500:
                            keys = list(_ais_state.keys())[:500]
                            for k in keys:
                                _ais_state.pop(k, None)
                                
        except Exception as e:
            logger.warning(f"AISStream connection error: {e}")
            await asyncio.sleep(5)


def _ensure_ais_listener():
    global _ais_ws_task
    if _ais_ws_task is None or _ais_ws_task.done():
        api_key = os.environ.get("AISSTREAM_API_KEY", "e7a7fb78b225406bf8b43aec35f0e1fa68157196")
        if api_key:
            loop = asyncio.get_event_loop()
            _ais_ws_task = loop.create_task(_ais_listener_loop(api_key))


@router.get("/ships/live")
async def get_live_ships():
    _ensure_ais_listener()
    
    # If WS just started and has no data, fallback to DEMO
    if not _ais_state:
        return {"ships": _DEMO_SHIPS, "cached": False, "count": len(_DEMO_SHIPS), "demo": True}
        
    data = list(_ais_state.values())
    
    # Prioritise military ships, cap civilians to avoid freezing frontend
    known = [s for s in data if s["mmsi"] in _KNOWN_MMSI]
    others = [s for s in data if s["mmsi"] not in _KNOWN_MMSI]
    final_data = known + others[:400]
    
    return {"ships": final_data, "cached": False, "count": len(final_data), "demo": False}


@router.get("/flights/history")
async def get_history_flights(
    timestamp: datetime = Query(...),
    db: AsyncSessionLocal = Depends(get_db)
):
    # Find the record closest to requested timestamp
    from sqlalchemy import func
    stmt = (
        select(FlightRecord)
        .order_by(func.abs(func.julianday(FlightRecord.timestamp) - func.julianday(timestamp)))
        .limit(1)
    )
    result = await db.execute(stmt)
    record = result.scalar_one_or_none()
    
    if not record:
        return {"aircraft": [], "count": 0, "timestamp": None}
        
    return {
        "aircraft": record.data,
        "count": len(record.data),
        "timestamp": record.timestamp
    }


@router.get("/ships/history")
async def get_history_ships(
    timestamp: datetime = Query(...),
    db: AsyncSessionLocal = Depends(get_db)
):
    """Get the closest vessel snapshot to the given timestamp."""
    from sqlalchemy import func
    stmt = (
        select(VesselRecord)
        .order_by(func.abs(func.julianday(VesselRecord.timestamp) - func.julianday(timestamp)))
        .limit(1)
    )
    result = await db.execute(stmt)
    record = result.scalar_one_or_none()
    
    if not record:
        return {"ships": [], "count": 0, "timestamp": None}
        
    return {
        "ships": record.data,
        "count": len(record.data),
        "timestamp": record.timestamp
    }
