import asyncio
import httpx
import logging
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from models import FinancialMetric

logger = logging.getLogger(__name__)

BINANCE_API_URL = "https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT"

async def fetch_btc_data(db: AsyncSession) -> dict | None:
    """Fetch 24h ticker data for BTCUSDT from Binance and save it to the database."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(BINANCE_API_URL)
            resp.raise_for_status()
            data = resp.json()
            
            price = float(data.get("lastPrice", 0))
            change_24h = float(data.get("priceChangePercent", 0))
            volume = float(data.get("volume", 0))
            
            if price > 0:
                metric = FinancialMetric(
                    symbol="BTCUSDT",
                    price=price,
                    change_24h=change_24h,
                    volume=volume,
                )
                db.add(metric)
                await db.commit()
                await db.refresh(metric)
                
                logger.info(f"[Finance] Fetched BTC: ${price} (24h: {change_24h}%)")
                return {
                    "symbol": "BTC",
                    "price": price,
                    "change": change_24h
                }
    except Exception as e:
        logger.error(f"[Finance] BTC data fetch failed: {e}")
        return None
