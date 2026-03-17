import asyncio
from models.database import AsyncSessionLocal
from models.schemas import NarrativeThread
from sqlalchemy import select

async def check():
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(NarrativeThread))
        rows = res.scalars().all()
        print(f"Found {len(rows)} Narrative Threads")
        for r in rows:
            print(f"- {r.title} ({r.category})")

if __name__ == "__main__":
    asyncio.run(check())
