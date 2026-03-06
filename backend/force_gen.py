import asyncio
from datetime import datetime, timezone, timedelta
from models.database import AsyncSessionLocal, init_db
from models.schemas import NewsItem, MilitaryEvent, AnalysisReport
from pipeline.ollama_client import generate_daily_summary
from sqlalchemy import select

async def main():
    print("Initialize DB...")
    await init_db()
    
    print("Fetching last 50 news and 30 events...")
    async with AsyncSessionLocal() as session:
        since = datetime.now(timezone.utc) - timedelta(days=5)
        
        news_result = await session.execute(
            select(NewsItem)
            .where(NewsItem.processed == True, NewsItem.published_at >= since)
            .order_by(NewsItem.published_at.desc())
            .limit(50)
        )
        news_items = news_result.scalars().all()
        
        events_result = await session.execute(
            select(MilitaryEvent)
            .where(MilitaryEvent.occurred_at >= since)
            .order_by(MilitaryEvent.occurred_at.desc())
            .limit(30)
        )
        events = events_result.scalars().all()

        financial_text = "BTC: $70100 (24h: -2.3%); WTI Oil: $81.5 (24h: 0.5%)"
        
        def _fmt_dt(dt: datetime | None) -> str:
            if not dt: return "[未知]"
            if dt.tzinfo is None: dt = dt.replace(tzinfo=timezone.utc)
            return (dt + timedelta(hours=8)).strftime("[%m-%d %H:%M]")
            
        news_text = "\n".join(f"{_fmt_dt(n.published_at)} [{n.source}] {n.title}" for n in news_items)
        events_text = "\n".join(f"{_fmt_dt(e.occurred_at)} [{e.event_type}] {e.title}" for e in events)
        
        print("Calling Ollama (qwen3-vl:8b)...")
        result = await generate_daily_summary(events_text, news_text, financial_text=financial_text)
        
        if result is None:
            print("No data.")
            return

        print(f"Ollama returned: {result}")
        print("Saving to DB...")
        
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
        session.add(report)
        await session.commit()
        print("Saved successfully!")

if __name__ == "__main__":
    asyncio.run(main())
