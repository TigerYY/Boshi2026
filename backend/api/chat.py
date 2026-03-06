from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timezone, timedelta
import asyncio

from models.database import get_db
from models.schemas import NewsItem, MilitaryEvent
from pipeline.ollama_client import ask_osint_question

router = APIRouter(prefix="/api/chat", tags=["chat"])

# 最多允许 2 个并发 OSINT 推理请求；超出立即返回 503，防止排队堆积打爆 Ollama
_osint_semaphore = asyncio.Semaphore(2)

class ChatRequest(BaseModel):
    message: str

class ChatResponse(BaseModel):
    reply: str
    status: str

@router.post("/query", response_model=ChatResponse)
async def query_osint(
    req: ChatRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    RAG Endpoint: Given a user natural language query, fetch recent relevant OSINT
    from the database, and inject it into an LLM context to formulate a response.
    """
    if not req.message or not req.message.strip():
        raise HTTPException(status_code=400, detail="Query message cannot be empty")

    # 并发保护：最多 2 个请求同时进入 Ollama 推理；第 3 个立即返回 503
    if _osint_semaphore.locked() and _osint_semaphore._value == 0:
        raise HTTPException(
            status_code=503,
            detail="推理通道繁忙，请稍后重试（当前已有最大并发推理任务）"
        )

    async with _osint_semaphore:
        try:
            since = datetime.now(timezone.utc) - timedelta(days=3)

            # Focus on very recent news (last 30 instead of 40)
            news_result = await db.execute(
                select(NewsItem)
                .where(NewsItem.processed == True, NewsItem.published_at >= since)
                .order_by(NewsItem.published_at.desc())
                .limit(30)
            )
            news_items = news_result.scalars().all()

            # Focus on very recent events (last 15 instead of 20)
            events_result = await db.execute(
                select(MilitaryEvent)
                .where(MilitaryEvent.occurred_at >= since)
                .order_by(MilitaryEvent.occurred_at.desc())
                .limit(15)
            )
            events = events_result.scalars().all()

            def _fmt_dt(dt: datetime | None) -> str:
                if not dt: return "[未知]"
                if dt.tzinfo is None: dt = dt.replace(tzinfo=timezone.utc)
                # Use a more compact format
                return (dt + timedelta(hours=8)).strftime("%m-%d %H:%M")

            news_text = "\n".join(f"• {_fmt_dt(n.published_at)} [{n.source}] {n.title}: {n.summary_zh or ''}" for n in news_items)
            events_text = "\n".join(f"• {_fmt_dt(e.occurred_at)} [{e.event_type}] {e.title} @ {e.location_name}" for e in events)

            context_block = f"""
### 待分析战场原始数据 (Raw Intel)
{news_text if news_text else "暂无相关新闻记录。"}

### 确证军事动作与地理占位
{events_text if events_text else "暂无相关确证事件。"}
"""
            reply = await ask_osint_question(req.message, context_block)
            return ChatResponse(reply=reply, status="ok")

        except HTTPException:
            raise
        except Exception as e:
            import traceback
            traceback.print_exc()
            raise HTTPException(status_code=500, detail=f"OSINT query generation failed: {str(e)}")
