import logging
import json
import socket
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from models import init_db, AsyncSessionLocal
from api import news_router, events_router, units_router, zones_router, analysis_router, control_router, live_router, youtube_router, chat_router, graph_router, timeline_router
from scheduler import scheduler, ws_manager, setup_scheduler

# Define internal tasks that just delegate to scheduler logic
async def run_all_scrapers():
    from scheduler import run_all_scrapers as ras
    await ras()

async def run_finance_scraper():
    from scheduler import run_finance_scraper as rfs
    await rfs()

async def run_daily_analysis():
    from scheduler import run_daily_analysis as rda
    await rda()

async def run_synthesis_task():
    from scheduler import run_synthesis_task as rst
    await rst()
        
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize DB (migrations)
    logging.info("Initializing database...")
    await init_db()

    # Seed demo data if DB is empty
    from models.schemas import MilitaryUnit
    from sqlalchemy import select, func
    async with AsyncSessionLocal() as db:
        count = await db.scalar(select(func.count(MilitaryUnit.id)))
        if count == 0:
            logging.info("Seeding demo data...")
            import seed_data
            await seed_data.seed()

    # Ensure scrapers are initialized
    from scrapers.sources import ALL_SCRAPERS
    from models.schemas import ScraperStatus
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

    logging.info("Starting scheduler...")
    setup_scheduler()
    scheduler.start()

    yield

    logging.info("Shutting down scheduler...")
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
app.include_router(chat_router)
app.include_router(graph_router)
app.include_router(timeline_router)

@app.get("/")
async def root():
    return {
        "status": "online",
        "system": "Warfare OSINT",
        "server_time": socket.gethostname()
    }

@app.get("/health")
async def health():
    return {"status": "healthy"}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # Handle incoming WS messages if needed
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
