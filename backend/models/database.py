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
            "ALTER TABLE analysis ADD COLUMN key_developments TEXT",
            "ALTER TABLE analysis ADD COLUMN outlook TEXT",
            "ALTER TABLE analysis ADD COLUMN escalation_probability FLOAT",
            "ALTER TABLE analysis ADD COLUMN market_correlation TEXT",
            "ALTER TABLE analysis ADD COLUMN abu_dhabi_risk FLOAT DEFAULT 0.0",
            "ALTER TABLE analysis ADD COLUMN abu_dhabi_status TEXT",
            "ALTER TABLE analysis ADD COLUMN forecast_data JSON",
            "ALTER TABLE analysis ADD COLUMN thinking_process TEXT",
        ]
        for sql in migrations:
            try:
                await conn.exec_driver_sql(sql)
            except Exception:
                pass  # column already exists
