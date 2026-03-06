import asyncio
import httpx
import logging
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from models import FinancialMetric

logger = logging.getLogger(__name__)

BINANCE_API_URL = "https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT"

# Yahoo Finance Chart API is typically open and requires no authentication for simple quotes
YFINANCE_URL = "https://query1.finance.yahoo.com/v8/finance/chart/CL=F?interval=1d&range=2d"

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

async def fetch_oil_data(db: AsyncSession) -> dict | None:
    """Fetch WTI Crude Oil (CL=F) data from Yahoo Finance."""
    try:
        # User-Agent is strictly required by Yahoo Finance API to avoid 403 Forbidden
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
        async with httpx.AsyncClient(headers=headers, timeout=10) as client:
            resp = await client.get(YFINANCE_URL)
            resp.raise_for_status()
            data = resp.json()

            res = data.get("chart", {}).get("result", [])
            if not res:
                row_missing = True
                raise ValueError("Yahoo Finance returned an empty result array.")
            
            meta = res[0].get("meta", {})
            current_price = float(meta.get("regularMarketPrice", 0))
            prev_close = float(meta.get("chartPreviousClose", 0))
            
            if current_price > 0 and prev_close > 0:
                change_24h = ((current_price - prev_close) / prev_close) * 100.0
                volume = float(meta.get("regularMarketVolume", 0))

                metric = FinancialMetric(
                    symbol="WTI_OIL",
                    price=current_price,
                    change_24h=change_24h,
                    volume=volume,
                )
                db.add(metric)
                await db.commit()
                await db.refresh(metric)
                
                logger.info(f"[Finance] Fetched WTI Oil: ${current_price:.2f} (24h: {change_24h:.2f}%)")
                return {
                    "symbol": "OIL",
                    "price": current_price,
                    "change": change_24h
                }
    except Exception as e:
        logger.error(f"[Finance] WTI Oil data fetch failed: {e}")
        return None
