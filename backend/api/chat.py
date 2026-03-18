import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timezone, timedelta
import asyncio

from models.database import get_db
from models.schemas import NewsItem, MilitaryEvent
from pipeline.ollama_client import ask_osint_question

router = APIRouter(prefix="/api/chat", tags=["chat"])
log = logging.getLogger(__name__)

_osint_semaphore = asyncio.Semaphore(2)


class Citation(BaseModel):
    id: int
    type: str
    time: str
    title: str


class ChatMeta(BaseModel):
    model: str = ""
    latency_ms: int = 0
    context_counts: dict = Field(default_factory=lambda: {"news": 0, "events": 0, "finance": 0})
    fallback_reason: Optional[str] = None
    parse_mode: Optional[str] = None
    request_id: str = ""


class ChatRequest(BaseModel):
    message: str
    lookback_days: int = Field(3, ge=1, le=30)


class ChatResponse(BaseModel):
    reply: str
    status: str
    answer: str
    core_assessment: str
    analysis: str
    citations: list[Citation]
    meta: ChatMeta


def _fmt_dt(dt: datetime | None) -> str:
    if not dt:
        return "[未知]"
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return (dt + timedelta(hours=8)).strftime("%m-%d %H:%M")


@router.post("/query", response_model=ChatResponse)
async def query_osint(
    req: ChatRequest,
    db: AsyncSession = Depends(get_db),
):
    request_id = str(uuid.uuid4())[:8]
    if not req.message or not req.message.strip():
        raise HTTPException(status_code=400, detail="Query message cannot be empty")

    if _osint_semaphore.locked() and _osint_semaphore._value == 0:
        raise HTTPException(
            status_code=503,
            detail="推理通道繁忙，请稍后重试（当前已有最大并发推理任务）",
        )

    async with _osint_semaphore:
        try:
            since = datetime.now(timezone.utc) - timedelta(days=req.lookback_days)

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

            finance_n = (1 if btc_metric else 0) + (1 if oil_metric else 0)
            financial_lines = []
            if btc_metric:
                financial_lines.append(
                    f"BTC {btc_metric.price:,.2f} (24h {btc_metric.change_24h}%)"
                )
            if oil_metric:
                financial_lines.append(
                    f"WTI {oil_metric.price:,.2f} (24h {oil_metric.change_24h}%)"
                )
            financial_ctx = (
                "### 金融锚点\n" + "\n".join(financial_lines)
                if financial_lines
                else "### 金融锚点\n暂无行情快照。"
            )

            news_result = await db.execute(
                select(NewsItem)
                .where(NewsItem.processed == True, NewsItem.published_at >= since)
                .order_by(NewsItem.published_at.desc())
                .limit(30)
            )
            news_items = news_result.scalars().all()

            events_result = await db.execute(
                select(MilitaryEvent)
                .where(MilitaryEvent.occurred_at >= since)
                .order_by(MilitaryEvent.occurred_at.desc())
                .limit(15)
            )
            events = events_result.scalars().all()

            citations: list[Citation] = []
            for n in news_items:
                citations.append(
                    Citation(
                        id=n.id,
                        type="news",
                        time=_fmt_dt(n.published_at),
                        title=(n.title or "")[:200],
                    )
                )
            for e in events:
                citations.append(
                    Citation(
                        id=e.id,
                        type="event",
                        time=_fmt_dt(e.occurred_at),
                        title=(e.title or "")[:200],
                    )
                )

            news_block = "\n".join(
                f"[N{n.id}] {_fmt_dt(n.published_at)} | {n.source} | {n.title}\n    摘要: {(n.summary_zh or '')[:280]}"
                for n in news_items
            )
            events_block = "\n".join(
                f"[E{e.id}] {_fmt_dt(e.occurred_at)} | {e.event_type} | {e.title} @ {e.location_name or ''}"
                for e in events
            )

            context_block = f"""{financial_ctx}

### 新闻情报 (N<id>，近 {req.lookback_days} 天，已处理)
{news_block if news_block else "（无）"}

### 确证事件 (E<id>)
{events_block if events_block else "（无）"}
"""

            counts = {
                "news": len(news_items),
                "events": len(events),
                "finance": finance_n,
            }

            if not news_items and not events:
                empty_msg = (
                    f"近 {req.lookback_days} 天内无已处理新闻与确证事件，无法做情报合成。"
                    "可调大「回溯天数」或先完成采集与入库后再问。"
                )
                log.warning(
                    "OSINT req=%s empty_context lookback=%s",
                    request_id,
                    req.lookback_days,
                )
                return ChatResponse(
                    reply=empty_msg,
                    status="degraded",
                    answer=empty_msg,
                    core_assessment="当前窗口内无可用情报样本。",
                    analysis=empty_msg,
                    citations=[],
                    meta=ChatMeta(
                        model="",
                        latency_ms=0,
                        context_counts=counts,
                        fallback_reason="no_intel_in_window",
                        parse_mode="skipped",
                        request_id=request_id,
                    ),
                )

            log.info(
                "OSINT req=%s lookback=%s counts=%s",
                request_id,
                req.lookback_days,
                counts,
            )
            result = await ask_osint_question(req.message.strip(), context_block)

            core = result.get("core_assessment") or ""
            analysis = result.get("analysis") or ""
            answer = result.get("answer") or ""
            llm_status = result.get("status") or "ok"
            api_status = "ok" if llm_status == "ok" else "degraded"

            meta = ChatMeta(
                model=result.get("model") or "",
                latency_ms=int(result.get("latency_ms") or 0),
                context_counts=counts,
                fallback_reason=result.get("fallback_reason"),
                parse_mode=result.get("parse_mode"),
                request_id=request_id,
            )

            return ChatResponse(
                reply=answer,
                status=api_status,
                answer=answer,
                core_assessment=core,
                analysis=analysis,
                citations=citations[:25],
                meta=meta,
            )

        except HTTPException:
            raise
        except Exception as e:
            log.exception("OSINT req=%s failed: %s", request_id, e)
            raise HTTPException(
                status_code=500,
                detail=f"OSINT query generation failed: {str(e)}",
            )
