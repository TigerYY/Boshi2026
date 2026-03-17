import asyncio
from models.database import engine
from sqlalchemy import text

async def migrate():
    async with engine.begin() as conn:
        print("Checking/Adding columns for 'news'...")
        try:
            await conn.execute(text('ALTER TABLE news ADD COLUMN thread_id INTEGER'))
            print("Added 'thread_id' to 'news'")
        except Exception as e:
            print(f"News: {e}")
            
        print("Checking/Adding columns for 'events'...")
        try:
            await conn.execute(text('ALTER TABLE events ADD COLUMN thread_id INTEGER'))
            print("Added 'thread_id' to 'events'")
        except Exception as e:
            print(f"Events: {e}")
            
        print("Creating 'narrative_threads' table...")
        try:
            await conn.execute(text('''
                CREATE TABLE IF NOT EXISTS narrative_threads (
                    id INTEGER PRIMARY KEY, 
                    title TEXT, 
                    summary TEXT, 
                    category TEXT, 
                    start_time DATETIME, 
                    last_updated DATETIME, 
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            '''))
            print("Table 'narrative_threads' ready")
        except Exception as e:
            print(f"Table: {e}")
            
    print("Migration finished")

if __name__ == "__main__":
    asyncio.run(migrate())
