import logging
import json
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from models import init_db
from api import news_router, events_router, units_router, zones_router, analysis_router, control_router, live_router, youtube_router
from scheduler import scheduler, ws_manager, setup_scheduler

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing database...")
    await init_db()

    # Seed demo data if DB is empty
    from models import AsyncSessionLocal
    from models.schemas import MilitaryUnit
    from sqlalchemy import select, func
    async with AsyncSessionLocal() as db:
        count = await db.scalar(select(func.count(MilitaryUnit.id)))
        if count == 0:
            logger.info("Seeding demo data...")
            import seed_data
            await seed_data.seed()

    # Ensure every scraper in sources.py has a ScraperStatus record
    from scrapers.sources import ALL_SCRAPERS
    from models.schemas import ScraperStatus
    from sqlalchemy import select
    async with AsyncSessionLocal() as db:
        for scraper in ALL_SCRAPERS:
            existing = await db.scalar(select(ScraperStatus).where(ScraperStatus.source_id == scraper.source_id))
            if not existing:
                db.add(ScraperStatus(
                    source_id=scraper.source_id,
                    source_name=scraper.source_name,
                    enabled=True,
                    auto_interval_minutes=60,
                ))
        await db.commit()

    logger.info("Starting scheduler...")
    setup_scheduler()
    scheduler.start()

    yield

    logger.info("Shutting down scheduler...")
    scheduler.shutdown(wait=False)


app = FastAPI(
    title="美伊战争态势系统 API",
    description="US-Iran War Situation Real-time Display System",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(news_router)
app.include_router(events_router)
app.include_router(units_router)
app.include_router(zones_router)
app.include_router(analysis_router)
app.include_router(control_router)
app.include_router(live_router)
app.include_router(youtube_router)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                if msg.get("type") == "ping":
                    await websocket.send_text(json.dumps({"type": "pong"}))
            except Exception:
                pass
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "boshi-warfare-system"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8100, reload=True)
