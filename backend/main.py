import logging
import json
import socket
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from models import init_db
from api import news_router, events_router, units_router, zones_router, analysis_router, control_router, live_router, youtube_router, chat_router
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
app.include_router(chat_router)


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


def find_available_port(host: str, start_port: int, max_attempts: int = 20) -> int:
    """
    寻找一个可用的端口。
    """
    for port in range(start_port, start_port + max_attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind((host, port))
                return port
            except socket.error:
                continue
    raise IOError(f"Could not find an available port in range {start_port} to {start_port + max_attempts - 1}")


if __name__ == "__main__":
    import uvicorn
    
    initial_port = 8100
    host = "0.0.0.0"
    
    try:
        port = find_available_port(host, initial_port)
        if port != initial_port:
            logger.info(f"Port {initial_port} is busy, using port {port} instead.")
        else:
            logger.info(f"Starting server on port {port}")
            
        uvicorn.run("main:app", host=host, port=port, reload=True)
    except Exception as e:
        logger.error(f"Failed to start server: {e}")
