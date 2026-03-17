import asyncio
from models.database import AsyncSessionLocal
from models.schemas import NarrativeThread, NewsItem, MilitaryEvent
from sqlalchemy import delete, update
from pipeline.synthesizer import run_synthesis

async def redo():
    async with AsyncSessionLocal() as db:
        print("Cleaning up existing threads...")
        await db.execute(delete(NarrativeThread))
        await db.execute(update(NewsItem).values(thread_id=None))
        await db.execute(update(MilitaryEvent).values(thread_id=None))
        await db.commit()
        
        print("Running fresh synthesis (last 7 days)...")
        count = await run_synthesis(db, lookback_hours=168)
        print(f"Synthesized {count} new threads.")

if __name__ == "__main__":
    asyncio.run(redo())
