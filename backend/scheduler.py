"""APScheduler-based background task scheduler with WebSocket broadcast."""
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Any
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy import select

from models import AsyncSessionLocal, ScraperStatus
from scrapers.sources import SCRAPER_MAP
from pipeline.processor import save_raw_articles, process_pending
from pipeline.ollama_client import generate_daily_summary
from scrapers.financial import fetch_btc_data

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler(timezone="UTC")

# ── Job overlap guards (prevent APScheduler concurrent re-entry) ───────────
_scraper_lock = asyncio.Lock()
_analysis_lock = asyncio.Lock()
_finance_lock = asyncio.Lock()

# ── WebSocket Connection Manager ───────────────────────────────────────────

class ConnectionManager:
    def __init__(self):
        self.active: set = set()
        self.last_states: dict[str, dict] = {}

    async def connect(self, ws):
        await ws.accept()
        self.active.add(ws)
        # Sync current state to new client
        import json
        for state in self.last_states.values():
            try:
                await ws.send_text(json.dumps(state, ensure_ascii=False, default=str))
            except Exception:
                pass

    def disconnect(self, ws):
        self.active.discard(ws)

    async def broadcast(self, message: dict):
        # Cache LLM status for new connections
        if message.get("type") == "llm_status":
            job = message.get("job")
            if job:
                self.last_states[job] = message

        if not self.active:
            return
        import json
        data = json.dumps(message, ensure_ascii=False, default=str)
        dead = set()
        for ws in list(self.active):
            try:
                await ws.send_text(data)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self.active.discard(ws)


ws_manager = ConnectionManager()


# ── Individual source scrape job ───────────────────────────────────────────

async def run_scraper(source_id: str):
    scraper = SCRAPER_MAP.get(source_id)
    if not scraper:
        return

    async with AsyncSessionLocal() as db:
        status = await db.scalar(
            select(ScraperStatus).where(ScraperStatus.source_id == source_id)
        )
        if status and not status.enabled:
            return
        if status:
            status.last_run = datetime.now(timezone.utc)
            status.error_msg = None
            await db.commit()

    # Call _fetch() directly so we capture real exceptions rather than the
    # empty-list-on-error behaviour of the public fetch() wrapper.
    try:
        articles = await scraper._fetch()
    except Exception as exc:
        err_text = str(exc)[:500]
        logger.error("Scraper %s failed: %s", source_id, err_text)
        async with AsyncSessionLocal() as db:
            status = await db.scalar(
                select(ScraperStatus).where(ScraperStatus.source_id == source_id)
            )
            if status:
                status.error_msg = err_text
                await db.commit()
        return

    if not articles:
        return

    async with AsyncSessionLocal() as db:
        status = await db.scalar(
            select(ScraperStatus).where(ScraperStatus.source_id == source_id)
        )
        try:
            saved = await save_raw_articles(articles, db, source_id)
            if status:
                status.last_success = datetime.now(timezone.utc)
                status.last_count = len(saved)
                await db.commit()

            if saved:
                await ws_manager.broadcast({
                    "type": "new_articles",
                    "source": source_id,
                    "count": len(saved),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })
        except Exception as e:
            logger.error(f"Scraper {source_id} save error: {e}")
            if status:
                status.error_msg = str(e)[:500]
                await db.commit()


async def run_all_scrapers():
    """Run all enabled scrapers in parallel. Skips run if previous one is still live."""
    if _scraper_lock.locked():
        logger.warning("run_all_scrapers: previous run still active, skipping this cycle")
        return
    async with _scraper_lock:
        tasks = [run_scraper(sid) for sid in SCRAPER_MAP]
        await asyncio.gather(*tasks, return_exceptions=True)

        # Process with AI — broadcast status so frontend can show spinner
        await ws_manager.broadcast({
            "type": "llm_status",
            "job": "news_processing",
            "state": "running",
            "label": "AI正在处理最新战报...",
        })
        async with AsyncSessionLocal() as db:
            count = await process_pending(db, limit=30)

        await ws_manager.broadcast({
            "type": "llm_status",
            "job": "news_processing",
            "state": "idle",
            "label": f"战报处理完成 (+{count}条)",
        })
        if count:
            await ws_manager.broadcast({
                "type": "ai_processed",
                "count": count,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })

async def run_finance_scraper():
    """Fetch macro financial prices (BTC & Oil) and broadcast to radar."""
    if _finance_lock.locked():
        return  # skip silently, finance updates are low-priority
    async with _finance_lock:
        from scrapers.financial import fetch_btc_data, fetch_oil_data

        async with AsyncSessionLocal() as db:
            btc_data = await fetch_btc_data(db)
            oil_data = await fetch_oil_data(db)

            if btc_data or oil_data:
                payload = {}
                if btc_data: payload["BTC"] = btc_data
                if oil_data: payload["OIL"] = oil_data

                await ws_manager.broadcast({
                    "type": "finance_update",
                    "data": payload,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })


async def run_daily_analysis():
    """Generate daily battlefield analysis report. Skips if previous run still live."""
    if _analysis_lock.locked():
        logger.warning("run_daily_analysis: previous analysis still running, skipping this cycle")
        await ws_manager.broadcast({
            "type": "llm_status",
            "job": "daily_analysis",
            "state": "skipped",
            "label": "AI综述跳过（上次尚未完成）",
        })
        return
    async with _analysis_lock:
        from models.schemas import NewsItem, MilitaryEvent, AnalysisReport
        try:
            await ws_manager.broadcast({
                "type": "llm_status",
                "job": "daily_analysis",
                "state": "running",
                "label": "Qwen3正在生成AI战场综述...",
            })
            async with AsyncSessionLocal() as db:
                since = datetime.now(timezone.utc) - timedelta(hours=24)

                from models.schemas import FinancialMetric

                btc_metric = await db.scalar(
                    select(FinancialMetric)
                    .where(FinancialMetric.symbol == "BTCUSDT")
                    .order_by(FinancialMetric.fetched_at.desc())
                    .limit(1)
                )
                oil_metric = await db.scalar(
                    select(FinancialMetric)
                    .where(FinancialMetric.symbol == "WTI_OIL")
                    .order_by(FinancialMetric.fetched_at.desc())
                    .limit(1)
                )

                financial_text = ""
                if btc_metric:
                    financial_text += f"今日比特币(BTC/USD)避险市场数据: 当前价格 {btc_metric.price:,.2f}, 24小时涨跌幅 {btc_metric.change_24h}%\n"
                if oil_metric:
                    financial_text += f"今日WTI原油大宗商品市场数据: 当前价格 {oil_metric.price:,.2f}, 24小时涨跌幅 {oil_metric.change_24h}%"

                news_result = await db.execute(
                    select(NewsItem)
                    .where(NewsItem.processed == True, NewsItem.published_at >= since)
                    .order_by(NewsItem.published_at.desc())
                    .limit(50)
                )
                news_items = news_result.scalars().all()

                events_result = await db.execute(
                    select(MilitaryEvent)
                    .where(MilitaryEvent.occurred_at >= since)
                    .order_by(MilitaryEvent.occurred_at.desc())
                    .limit(30)
                )
                events = events_result.scalars().all()

                news_text = "\n".join(
                    f"[{n.source}] {n.title}: {n.summary_zh or n.title}" for n in news_items
                )
                events_text = "\n".join(
                    f"[{e.event_type}] {e.title} @ {e.location_name}" for e in events
                )

                result = await generate_daily_summary(events_text, news_text, financial_text=financial_text)

                if result is None:
                    logger.warning("run_daily_analysis: no input data, skipping report write")
                    await ws_manager.broadcast({
                        "type": "llm_status",
                        "job": "daily_analysis",
                        "state": "idle",
                        "label": "无新战情，暂不生成综述",
                    })
                    return

                report = AnalysisReport(
                    report_type="daily_summary",
                    content=result.get("summary", ""),
                    period_start=since,
                    period_end=datetime.now(timezone.utc),
                    intensity_score=result.get("intensity_score", 5.0),
                    hotspots=result.get("hotspots", []),
                    key_developments=result.get("key_developments", []),
                    outlook=result.get("outlook", ""),
                    escalation_probability=result.get("escalation_probability", 50.0),
                    market_correlation=result.get("market_correlation", ""),
                    abu_dhabi_risk=result.get("abu_dhabi_risk", 10.0),
                    abu_dhabi_status=result.get("abu_dhabi_status", "阿联酋本土目前维持日常警戒，未受周边冲突直接波及。"),
                )
                db.add(report)
                await db.commit()

                await ws_manager.broadcast({
                    "type": "analysis_updated",
                    "report_type": "daily_summary",
                    "intensity_score": result.get("intensity_score", 5.0),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })
                await ws_manager.broadcast({
                    "type": "llm_status",
                    "job": "daily_analysis",
                    "state": "idle",
                    "label": "AI战场综述已更新",
                })
        except Exception as exc:
            logger.error("run_daily_analysis failed: %s", exc)
            await ws_manager.broadcast({
                "type": "llm_status",
                "job": "daily_analysis",
                "state": "error",
                "label": f"AI分析失败: {str(exc)[:60]}",
            })


def setup_scheduler():
    """Register all scheduled jobs.

    Scraping runs every 60 minutes.  Analysis is staggered by +30 min so that
    the AI pipeline starts after the scrape batch has finished, and misfire_grace_time
    is raised to 600 s to accommodate slow scrape cycles.
    """
    scheduler.add_job(
        run_all_scrapers,
        trigger=IntervalTrigger(minutes=60),
        id="all_scrapers",
        replace_existing=True,
        misfire_grace_time=600,
    )
    # Offset analysis by 30 minutes so it runs after scraping completes
    analysis_start = datetime.now(timezone.utc) + timedelta(minutes=30)
    scheduler.add_job(
        run_daily_analysis,
        trigger=IntervalTrigger(minutes=60, start_date=analysis_start),
        id="daily_analysis",
        replace_existing=True,
        misfire_grace_time=600,
    )
    # Pull financial data every 5 minutes
    scheduler.add_job(
        run_finance_scraper,
        trigger=IntervalTrigger(minutes=5),
        id="finance_scraper",
        replace_existing=True,
        misfire_grace_time=60,
    )
