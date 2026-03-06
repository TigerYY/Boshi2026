from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timezone, timedelta

from models.database import get_db
from models.schemas import NewsItem, MilitaryEvent
from pipeline.ollama_client import ask_osint_question

router = APIRouter(prefix="/api/chat", tags=["chat"])

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
        
    try:
        # Retrieve recent 3 days of OSINT
        since = datetime.now(timezone.utc) - timedelta(days=3)
        
        # 1. Fetch recent news
        news_result = await db.execute(
            select(NewsItem)
            .where(NewsItem.processed == True, NewsItem.published_at >= since)
            .order_by(NewsItem.published_at.desc())
            .limit(40) # Keep limit reasonable for context window
        )
        news_items = news_result.scalars().all()
        
        # 2. Fetch military events
        events_result = await db.execute(
            select(MilitaryEvent)
            .where(MilitaryEvent.occurred_at >= since)
            .order_by(MilitaryEvent.occurred_at.desc())
            .limit(20)
        )
        events = events_result.scalars().all()
        
        # 3. Format context
        def _fmt_dt(dt: datetime | None) -> str:
            if not dt: return "[未知日期]"
            if dt.tzinfo is None: dt = dt.replace(tzinfo=timezone.utc)
            return (dt + timedelta(hours=8)).strftime("[%m-%d %H:%M]")
            
        news_text = "\n".join(f"- {_fmt_dt(n.published_at)} [{n.source}] {n.title}: {n.summary_zh or ''}" for n in news_items)
        events_text = "\n".join(f"- {_fmt_dt(e.occurred_at)} [事件:{e.event_type}] {e.title} @ 坐标:{e.location_name}" for e in events)
        
        context_block = f"""
【最新开源军情 (OSINT) 动态】
{news_text}

【近期确认交火/军事事件】
{events_text}
"""
        # 4. Ask LLM
        reply = await ask_osint_question(req.message, context_block)
        
        return ChatResponse(reply=reply, status="ok")
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"OSINT query generation failed: {str(e)}")
