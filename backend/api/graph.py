from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any

from models.database import get_db
from models.schemas import NewsItem, MilitaryEvent, AnalysisReport

router = APIRouter(prefix="/api/graph", tags=["graph"])

# 极大扩展地名、实体与术语映射
EN_ZH_MAP = {
    "hormuz": "霍尔木兹海峡",
    "strait of hormuz": "霍尔木兹海峡",
    "iran": "伊朗",
    "us": "美国",
    "usa": "美国",
    "israel": "以色列",
    "iraq": "伊拉克",
    "syria": "叙利亚",
    "yemen": "也门",
    "red sea": "红海",
    "persian gulf": "波斯湾",
    "gulf of oman": "阿曼湾",
    "uae": "阿联酋",
    "saudi": "沙特",
    "tehran": "德黑兰",
    "airstrike": "空袭",
    "naval": "海军行动",
    "missile": "导弹攻击",
    "diplomacy": "外交事件",
    "sanction": "经济制裁",
    "movement": "兵力部署",
    "carrier": "航母编队",
    "destroyer": "驱逐舰",
    "drone": "无人机",
    "tanker": "油轮",
    "oil": "原油",
    "explosion": "爆炸",
    "cyber": "网络攻击",
    "proxy": "代理人武装",
    "warning": "风险预警",
    "attack": "袭击",
}

def clean_label(label: str) -> str:
    if not label: return ""
    import re
    # 1. 剥离外层的方括号、书名号或大括号
    cleaned = label.strip().strip('[]【】{}')
    # 2. 移除常见的英文标签头 (全局匹配，不限于开头)
    cleaned = re.sub(r'(tags[:：]|category[:：]|topic[:：])\s*', '', cleaned, flags=re.IGNORECASE)
    # 3. 再次清理多余空格并剥离可能残留在内部的括号
    cleaned = cleaned.strip().strip('[]【】{}')
    
    l = cleaned.lower()
    return EN_ZH_MAP.get(l, cleaned)

@router.get("/knowledge")
async def get_knowledge_graph(days: int = 7, db: AsyncSession = Depends(get_db)):
    """
    聚合最近 days 天的实体数据，构建 Node-Link 知识图谱结构
    """
    since = datetime.now(timezone.utc) - timedelta(days=days)

    # 1. 查询基础数据
    # 显著提升 limit 以覆盖 30 天的全量关键情报
    news_result = await db.execute(
        select(NewsItem)
        .where(NewsItem.published_at >= since, NewsItem.processed == True)
        .order_by(NewsItem.published_at.desc())
        .limit(2000)
    )
    news_items = news_result.scalars().all()

    events_result = await db.execute(
        select(MilitaryEvent)
        .where(MilitaryEvent.occurred_at >= since)
        .order_by(MilitaryEvent.occurred_at.desc())
        .limit(1000)
    )
    events = events_result.scalars().all()

    reports_result = await db.execute(
        select(AnalysisReport)
        .where(AnalysisReport.generated_at >= since)
        .order_by(AnalysisReport.generated_at.desc())
        .limit(12)
    )
    reports = reports_result.scalars().all()

    # 2. 组装 Graph 结构
    nodes = []
    links = []
    
    # 用来避免重复的节点和边
    node_ids = set()
    links_set = set()

    # 组名中文化映射
    GROUP_ZH = {
        "event": "事件",
        "news": "新闻",
        "location": "地理",
        "report": "研判",
        "tag": "特征"
    }

    def add_node(node_id: str, label: str, group: str, attributes: Dict = None):
        if node_id not in node_ids:
            # 缩写标签：如果是长字符串则截断
            translated_label = clean_label(label)
            display_label = translated_label[:12] + "..." if len(translated_label) > 14 else translated_label
            nodes.append({
                "id": node_id,
                "label": display_label,
                "group": group,
                "group_zh": GROUP_ZH.get(group, group),
                **(attributes or {})
            })
            node_ids.add(node_id)

    def add_link(source: str, target: str, label: str = ""):
        link_id = f"{source}->{target}"
        if link_id not in links_set:
            links.append({
                "source": source,
                "target": target,
                "label": label
            })
            links_set.add(link_id)

    # 3. 处理 Events -> Locations
    for event in events:
        event_id = f"event_{event.id}"
        add_node(event_id, event.title, "event", {
            "title": event.title,
            "desc": event.description or "",
            "val": event.severity * 2,
            "time": str(event.occurred_at)
        })

        if event.location_name:
            loc_name = clean_label(event.location_name)
            loc_id = f"loc_{loc_name}"
            add_node(loc_id, loc_name, "location", {"val": 3})
            add_link(event_id, loc_id, "发生于")

    # 4. 处理 News -> Locations/Tags
    for news in news_items:
        news_id = f"news_{news.id}"
        
        # 优先使用中文摘要作为标签，若无则使用截断后的标题
        news_label = news.summary_zh or news.title
        add_node(news_id, news_label, "news", {
            "title": news.title,
            "desc": news.summary_zh,
            "val": 2,
            "time": str(news.published_at)
        })

        if news.locations and isinstance(news.locations, list):
            for loc in news.locations:
                try:
                    name = loc.get('name')
                    if not name: continue
                    loc_name = clean_label(name)
                    loc_id = f"loc_{loc_name}"
                    add_node(loc_id, loc_name, "location", {"val": 4})
                    add_link(news_id, loc_id, "提及")
                except Exception:
                    continue

    # 5. 处理 AI Reports -> Location/Hotspots
    for rep in reports:
        rep_id = f"report_{rep.id}"
        add_node(rep_id, f"综合研判 {rep.generated_at.strftime('%m-%d')}", "report", {
            "title": "OSINT 研判",
            "desc": rep.content,
            "val": 5,
            "time": str(rep.generated_at)
        })
        
        if rep.hotspots and isinstance(rep.hotspots, list):
            for hp in rep.hotspots:
                try:
                    name = hp.get('name')
                    if not name: continue
                    loc_name = clean_label(name)
                    loc_id = f"loc_{loc_name}"
                    add_node(loc_id, loc_name, "location", {"val": 5})
                    add_link(rep_id, loc_id, "聚焦")
                except Exception:
                    continue

    return {"nodes": nodes, "links": links}
