import asyncio
from models.database import AsyncSessionLocal
from models.schemas import NewsItem
from sqlalchemy import select

async def check():
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(NewsItem).where(NewsItem.thread_id != None))
        rows = res.scalars().all()
        print(f"Found {len(rows)} threaded news items.")
        for r in rows:
            print(f"ID: {r.id}")
            print(f"  Title: {r.title}")
            print(f"  Thread ID: {r.thread_id}")
            print(f"  Published: {r.published_at} (Type: {type(r.published_at)})")
            print(f"  Fetched: {r.fetched_at} (Type: {type(r.fetched_at)})")
            print("-" * 20)

if __name__ == "__main__":
    asyncio.run(check())
