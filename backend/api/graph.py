from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any
import logging

from models.database import get_db
from models.schemas import NewsItem, MilitaryEvent, AnalysisReport, NarrativeThread, CausalLink
from ._utils import iso_utc

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/graph", tags=["graph"])

# 关系语义转换
RELATION_ZH = {
    "caused": "导致",
    "responded_to": "响应",
    "escalated": "升级",
    "conflicts_with": "矛盾",
    "mitigating": "缓解"
}

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
async def get_knowledge_graph(
    days: int = 7, 
    interpretation: bool = True,
    db: AsyncSession = Depends(get_db)
):
    """
    聚合最近 days 天的实体数据，构建 Node-Link 知识图谱结构。
    interpretation: True 为 AI 研判模式（结构化），False 为纷杂情报模式（回归初版）。
    """
    now = datetime.now(timezone.utc)
    since = now if days == 0 else (now - timedelta(days=days))

    # 查询基础数据
    news_stmt = select(NewsItem).where(NewsItem.published_at >= since)
    if interpretation:
        news_stmt = news_stmt.where(NewsItem.processed == True).limit(2000)
    else:
        news_stmt = news_stmt.limit(3000) # 原始模式承载更多节点以体现“全貌”
        
    news_result = await db.execute(news_stmt.order_by(NewsItem.published_at.desc()))
    news_items = news_result.scalars().all()

    events_result = await db.execute(
        select(MilitaryEvent).where(MilitaryEvent.occurred_at >= since).limit(1000)
    )
    events = events_result.scalars().all()

    nodes = []
    links = []
    node_ids = set()
    links_set = set()

    GROUP_ZH = {
        "event": "事件", "news": "情报", "location": "地理",
        "report": "研判", "tag": "特征", "thread": "叙事脉络"
    }

    def add_node(node_id: str, label: str, group: str, attributes: Dict = None):
        if node_id not in node_ids:
            display_label = label[:14] + ".." if len(label) > 16 else label
            nodes.append({
                "id": node_id, "label": display_label, "group": group,
                "group_zh": GROUP_ZH.get(group, group),
                **(attributes or {})
            })
            node_ids.add(node_id)

    def add_link(source: str, target: str, label: str = "", attr: Dict = None):
        link_id = f"{source}->{target}"
        if link_id not in links_set:
            links.append({"source": source, "target": target, "label": label, **(attr or {})})
            links_set.add(link_id)

    # ── [ 分支 A: AI 研判模式 ] ──────────────────────────────────────────────
    if interpretation:
        # 获取高阶合成数据
        reports_result = await db.execute(select(AnalysisReport).where(AnalysisReport.generated_at >= since).limit(10))
        reports = reports_result.scalars().all()

        thread_ids = {n.thread_id for n in news_items if n.thread_id} | {e.thread_id for e in events if e.thread_id}
        threads = []
        if thread_ids:
            t_res = await db.execute(select(NarrativeThread).where(NarrativeThread.id.in_(list(thread_ids))))
            threads = t_res.scalars().all()

        # 1. 线索枢纽
        for t in threads:
            add_node(f"thread_{t.id}", t.title, "thread", {"desc": t.summary, "val": 10, "time": iso_utc(t.last_updated or t.created_at)})

        # 2. 军事事件
        for e in events:
            eid = f"event_{e.id}"
            add_node(eid, e.title, "event", {
                "desc": e.description, 
                "val": 3 + e.impact_score,
                "time": iso_utc(e.occurred_at)
            })
            if e.thread_id: add_link(eid, f"thread_{e.thread_id}", "属于")
            if e.location_name:
                loc_id = f"loc_{clean_label(e.location_name)}"
                add_node(loc_id, clean_label(e.location_name), "location", {"val": 4})
                add_link(eid, loc_id, "发生地")

        # 3. 研判新闻 (AI 提炼版)
        for n in news_items:
            nid = f"news_{n.id}"
            add_node(nid, n.summary_zh or n.title, "news", {
                "desc": n.summary_zh, 
                "val": 2 + n.impact_score,
                "time": iso_utc(n.published_at)
            })
            if n.thread_id: add_link(nid, f"thread_{n.thread_id}", "关联线索")
            if n.locations:
                for loc in n.locations:
                    l_name = clean_label(loc.get('name'))
                    if l_name:
                        lid = f"loc_{l_name}"; add_node(lid, l_name, "location", {"val": 4})
                        add_link(nid, lid, "提及")
            if n.tags:
                for t in n.tags:
                    t_name = clean_label(t)
                    tid = f"tag_{t_name}"; add_node(tid, t_name, "tag", {"val": 3})
                    add_link(nid, tid, "包含")

        # 4. 因果链路 (研判模式专有)
        try:
            cl_res = await db.execute(select(CausalLink).where(CausalLink.created_at >= since).limit(100))
            for cl in cl_res.scalars().all():
                s, t = f"{cl.source_type}_{cl.source_id}", f"{cl.target_type}_{cl.target_id}"
                if s in node_ids and t in node_ids:
                    add_link(s, t, RELATION_ZH.get(cl.relation_type, cl.relation_type), 
                             {"type": "causal", "color": "#ffaa00", "curvature": 0.2})
        except: pass

    # ── [ 分支 B: 原始情报模式 ] ───────── (完全回溯至初版逻辑-无LLM) ───────────
    else:
        # 1. 原始新闻 (无摘要，无 thread，无标签，基于位置的原始映射)
        for n in news_items:
            nid = f"news_{n.id}"
            # 严格使用原始抓取标题，不显示 summary_zh
            add_node(nid, n.title, "news", {
                "desc": n.content or "Raw Intel Output", 
                "val": 2.5,
                "time": iso_utc(n.published_at)
            })
            if n.locations:
                for loc in n.locations:
                    l_name = clean_label(loc.get('name'))
                    if l_name:
                        lid = f"loc_{l_name}"; add_node(lid, l_name, "location", {"val": 4})
                        add_link(nid, lid, "Loc")

        # 2. 原始军事事件 (点对点映射)
        for e in events:
            eid = f"event_{e.id}"
            add_node(eid, e.title, "event", {
                "desc": e.description, 
                "val": 3.5,
                "time": iso_utc(e.occurred_at)
            })
            if e.location_name:
                l_name = clean_label(e.location_name)
                lid = f"loc_{l_name}"; add_node(lid, l_name, "location", {"val": 4})
                add_link(eid, lid, "Loc")

        # 注意：此处没有任何 thread, causal, report 或“语义同步”边

    return {"nodes": nodes, "links": links}
