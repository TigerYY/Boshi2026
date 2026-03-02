from sqlalchemy import Column, Integer, String, Float, DateTime, Text, Boolean, JSON
from sqlalchemy.sql import func
from .database import Base


class NewsItem(Base):
    __tablename__ = "news"

    id = Column(Integer, primary_key=True, autoincrement=True)
    source = Column(String(100), nullable=False)
    source_tier = Column(Integer, default=2)          # 1=primary, 2=secondary, 3=domestic
    title = Column(Text, nullable=False)
    url = Column(String(500), unique=True, nullable=False)
    content = Column(Text)
    published_at = Column(DateTime)
    fetched_at = Column(DateTime, server_default=func.now())
    # AI processed fields
    summary_zh = Column(Text)
    category = Column(String(50))                     # airstrike/diplomacy/sanction/movement/missile/other
    confidence = Column(Float, default=0.5)           # 0-1 credibility
    locations = Column(JSON)                          # [{name, lat, lon}, ...]
    image_url = Column(String(500))
    image_analysis = Column(Text)
    processed = Column(Boolean, default=False)
    is_breaking = Column(Boolean, default=False)


class MilitaryEvent(Base):
    __tablename__ = "events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    event_type = Column(String(50), nullable=False)   # airstrike/naval/land/missile/diplomacy/sanction
    title = Column(Text, nullable=False)
    description = Column(Text)
    lat = Column(Float)
    lon = Column(Float)
    location_name = Column(String(200))
    occurred_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, server_default=func.now())
    source_news_id = Column(Integer)
    side = Column(String(20))                         # US/Iran/proxy/neutral
    confirmed = Column(Boolean, default=False)
    severity = Column(Integer, default=1)             # 1-5
    casualties = Column(JSON)                         # {killed: n, wounded: n, source: str}
    extra = Column(JSON)


class MilitaryUnit(Base):
    __tablename__ = "units"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(200), nullable=False)
    unit_type = Column(String(50))                    # carrier/destroyer/airbase/army/missile/drone
    side = Column(String(20))                         # US/Iran/proxy
    lat = Column(Float)
    lon = Column(Float)
    location_name = Column(String(200))
    status = Column(String(50), default="deployed")   # deployed/moving/engaged/withdrawn
    updated_at = Column(DateTime, server_default=func.now())
    extra = Column(JSON)


class ControlZone(Base):
    __tablename__ = "control_zones"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(200))
    zone_type = Column(String(50))                    # control/exclusion/patrol/blockade
    side = Column(String(20))
    geojson = Column(JSON)                            # GeoJSON polygon
    valid_from = Column(DateTime)
    valid_to = Column(DateTime)
    updated_at = Column(DateTime, server_default=func.now())


class AnalysisReport(Base):
    __tablename__ = "analysis"

    id = Column(Integer, primary_key=True, autoincrement=True)
    report_type = Column(String(50))                  # daily_summary/trend/hotspot
    content = Column(Text)
    generated_at = Column(DateTime, server_default=func.now())
    period_start = Column(DateTime)
    period_end = Column(DateTime)
    intensity_score = Column(Float)                   # 0-10 conflict intensity
    hotspots = Column(JSON)                           # [{lat, lon, score, name}, ...]
    key_developments = Column(JSON)                   # ["要点1", "要点2", ...]
    outlook = Column(Text)                            # 50字未来研判


class ScraperStatus(Base):
    __tablename__ = "scraper_status"

    id = Column(Integer, primary_key=True, autoincrement=True)
    source_id = Column(String(100), unique=True, nullable=False)
    source_name = Column(String(200))
    enabled = Column(Boolean, default=True)
    last_run = Column(DateTime)
    last_success = Column(DateTime)
    last_count = Column(Integer, default=0)
    error_msg = Column(Text)
    auto_interval_minutes = Column(Integer, default=15)
