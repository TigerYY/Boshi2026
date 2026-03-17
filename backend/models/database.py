from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from pathlib import Path

DB_PATH = Path(__file__).parent.parent.parent / "data" / "warfare.db"
DB_PATH.parent.mkdir(exist_ok=True)

engine = create_async_engine(f"sqlite+aiosqlite:///{DB_PATH}", echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Migrate: add new columns to existing tables (ignore if already exist)
        migrations = [
            "ALTER TABLE news ADD COLUMN tags JSON",
            "ALTER TABLE news ADD COLUMN impact_score FLOAT DEFAULT 2.0",
            "ALTER TABLE events ADD COLUMN tags JSON",
            "ALTER TABLE events ADD COLUMN impact_score FLOAT DEFAULT 3.0",
            "CREATE TABLE IF NOT EXISTS narrative_threads (id INTEGER PRIMARY KEY, title TEXT, summary TEXT, category String, start_time DATETIME, last_updated DATETIME)",
            "ALTER TABLE news ADD COLUMN thread_id INTEGER",
            "ALTER TABLE events ADD COLUMN thread_id INTEGER",
            "ALTER TABLE analysis ADD COLUMN key_developments TEXT",
            "ALTER TABLE analysis ADD COLUMN outlook TEXT",
            "ALTER TABLE analysis ADD COLUMN escalation_probability FLOAT",
            "ALTER TABLE analysis ADD COLUMN market_correlation TEXT",
            "ALTER TABLE analysis ADD COLUMN abu_dhabi_risk FLOAT DEFAULT 0.0",
            "ALTER TABLE analysis ADD COLUMN abu_dhabi_status TEXT",
            "ALTER TABLE analysis ADD COLUMN forecast_data JSON",
            "ALTER TABLE analysis ADD COLUMN thinking_process TEXT",
            "CREATE TABLE IF NOT EXISTS causal_links (id INTEGER PRIMARY KEY AUTOINCREMENT, source_type TEXT, source_id INTEGER, target_type TEXT, target_id INTEGER, relation_type TEXT, confidence FLOAT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
        ]
        for sql in migrations:
            try:
                await conn.exec_driver_sql(sql)
            except Exception:
                pass  # column already exists
