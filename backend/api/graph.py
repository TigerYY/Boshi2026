from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, asc
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional
import logging
import os

from models.database import get_db
from models.schemas import NewsItem, MilitaryEvent, AnalysisReport, NarrativeThread, CausalLink
from ._utils import iso_utc

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/graph", tags=["graph"])
REPORT_FAIL_CONTENT = ("分析生成失败", "研判暂不可用", "暂无法生成研判")

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

def _parse_until(until_str: Optional[str]) -> datetime:
    """Parse ISO until to UTC datetime; default now."""
    now = datetime.now(timezone.utc)
    if not until_str:
        return now
    try:
        from dateutil import parser as dateutil_parser
        dt = dateutil_parser.isoparse(until_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return now


@router.get("/knowledge")
async def get_knowledge_graph(
    days: int = 7,
    interpretation: bool = True,
    include_failed_reports: bool = False,
    until: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """
    按时间窗口聚合实体数据，构建 Node-Link 知识图谱。
    until: 窗口右边界（ISO 时间，默认当前）；days: 窗口宽度（天）。
    windowStart = until - days, windowEnd = until；所有查询基于 [windowStart, windowEnd]。
    interpretation: True 为 AI 研判模式，False 为原始情报模式。
    """
    interpretation = bool(interpretation)
    now = datetime.now(timezone.utc)
    window_end = _parse_until(until)
    if window_end > now:
        window_end = now
    days_clamped = max(1, min(365, days))
    window_start = window_end - timedelta(days=days_clamped)

    # 查询基础数据（严格在窗口内）
    news_stmt = select(NewsItem).where(
        NewsItem.published_at >= window_start,
        NewsItem.published_at <= window_end,
    )
    if interpretation:
        news_stmt = news_stmt.where(NewsItem.processed == True).limit(2000)
    else:
        news_stmt = news_stmt.limit(3000) # 原始模式承载更多节点以体现“全貌”
        
    news_result = await db.execute(news_stmt.order_by(NewsItem.published_at.desc()))
    news_items = news_result.scalars().all()

    events_result = await db.execute(
        select(MilitaryEvent)
        .where(
            MilitaryEvent.occurred_at >= window_start,
            MilitaryEvent.occurred_at <= window_end,
        )
        .order_by(MilitaryEvent.occurred_at.desc())
        .limit(1000)
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
            display_label = (label[:14] + "..") if len(label) > 14 else label
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
        max_orphans = max(0, min(200, int(os.getenv("GRAPH_INTERP_MAX_ORPHANS", "25"))))
        # 获取高阶合成数据
        reports_result = await db.execute(select(AnalysisReport).where(
            AnalysisReport.generated_at >= window_start,
            AnalysisReport.generated_at <= window_end,
        ).order_by(AnalysisReport.generated_at.desc()).limit(10))
        reports_raw = reports_result.scalars().all()
        reports: list[AnalysisReport] = []
        filtered_failed_reports = 0
        for r in reports_raw:
            fd = r.forecast_data or {}
            meta = fd.get("__report_meta", {}) if isinstance(fd, dict) else {}
            is_valid = bool(meta.get("is_valid_report", True))
            # Backward compatibility: old reports may miss __report_meta but still
            # contain explicit failure text in content.
            if is_valid and any(pat in (r.content or "") for pat in REPORT_FAIL_CONTENT):
                is_valid = False
            if include_failed_reports or is_valid:
                reports.append(r)
            else:
                filtered_failed_reports += 1

        thread_ids = {n.thread_id for n in news_items if n.thread_id} | {e.thread_id for e in events if e.thread_id}
        threads = []
        if thread_ids:
            ids_sorted = sorted(thread_ids)
            t_res = await db.execute(
                select(NarrativeThread)
                .where(NarrativeThread.id.in_(ids_sorted))
                .order_by(asc(NarrativeThread.id))
            )
            threads = t_res.scalars().all()

        def _report_at(r: AnalysisReport):
            return (r.generated_at or r.period_end or now).replace(tzinfo=timezone.utc) if r.generated_at or r.period_end else now

        def _nearest_report_id(dt) -> Optional[str]:
            if not reports:
                return None
            try:
                t = dt.replace(tzinfo=timezone.utc) if dt and getattr(dt, "tzinfo", None) is None else (dt or now)
            except Exception:
                t = now
            best = min(reports, key=lambda r: abs((_report_at(r) - t).total_seconds()))
            return f"report_{best.id}"

        # 0) 预扫描：提取线索项、因果项和高影响孤儿项，避免 "纳入研判" 星爆
        thread_linked_ids: set[str] = set()
        orphan_candidates: list[tuple[float, str]] = []
        for e in events:
            eid = f"event_{e.id}"
            if e.thread_id:
                thread_linked_ids.add(eid)
            else:
                orphan_candidates.append((float(e.impact_score or 0.0), eid))
        for n in news_items:
            nid = f"news_{n.id}"
            if n.thread_id:
                thread_linked_ids.add(nid)
            else:
                orphan_candidates.append((float(n.impact_score or 0.0), nid))

        causal_pairs: list[tuple[str, str, str]] = []
        causal_linked_ids: set[str] = set()
        try:
            cl_res = await db.execute(select(CausalLink).order_by(asc(CausalLink.id)).limit(300))
            for cl in cl_res.scalars().all():
                s, t = f"{cl.source_type}_{cl.source_id}", f"{cl.target_type}_{cl.target_id}"
                relation = RELATION_ZH.get(cl.relation_type, cl.relation_type)
                causal_pairs.append((s, t, relation))
                causal_linked_ids.add(s)
                causal_linked_ids.add(t)
        except Exception as e:
            logger.warning("Causal links fetch failed: %s", e)

        baseline_keep_ids = thread_linked_ids | causal_linked_ids
        orphan_candidates.sort(key=lambda x: x[0], reverse=True)
        selected_orphan_ids: set[str] = set()
        for _, iid in orphan_candidates:
            if iid in baseline_keep_ids:
                continue
            selected_orphan_ids.add(iid)
            if len(selected_orphan_ids) >= max_orphans:
                break
        keep_item_ids = baseline_keep_ids | selected_orphan_ids

        # 1. 研判报告节点（中心锚点）
        for r in reports:
            rid = f"report_{r.id}"
            fd = r.forecast_data or {}
            rmeta = fd.get("__report_meta", {}) if isinstance(fd, dict) else {}
            is_valid = bool(rmeta.get("is_valid_report", True))
            source_text = r.outlook or r.content or f"研判{r.report_type or '综合'}"
            if not is_valid:
                source_text = "研判暂不可用"
            label = source_text[:14]
            if len(source_text or "") > 14:
                label = label.rstrip() + ".."
            add_node(rid, label or f"报告{r.id}", "report", {
                "desc": (r.outlook or r.content) if is_valid else "",
                "val": 12,
                "time": iso_utc(r.generated_at or r.period_end),
                "impact_score": r.intensity_score,
                "is_valid_report": is_valid,
                "error_code": rmeta.get("error_code", ""),
            })

        # 2. 线索枢纽
        for t in threads:
            add_node(f"thread_{t.id}", t.title, "thread", {"desc": t.summary, "val": 10, "time": iso_utc(t.last_updated or t.created_at)})
        # 将叙事脉络挂到时间重叠的最近一期报告上
        for t in threads:
            t_time = t.last_updated or t.created_at
            if t_time:
                rid = _nearest_report_id(t_time)
                if rid and rid in node_ids:
                    add_link(f"thread_{t.id}", rid, "汇总")

        # 3. 军事事件
        for e in events:
            eid = f"event_{e.id}"
            if eid not in keep_item_ids:
                continue
            add_node(eid, e.title, "event", {
                "desc": e.description,
                "val": 3 + e.impact_score,
                "time": iso_utc(e.occurred_at)
            })
            if e.thread_id:
                add_link(eid, f"thread_{e.thread_id}", "属于")
            elif eid in selected_orphan_ids:
                rid = _nearest_report_id(e.occurred_at)
                if rid and rid in node_ids:
                    add_link(eid, rid, "纳入研判")

        # 4. 研判新闻 (AI 提炼版)
        for n in news_items:
            nid = f"news_{n.id}"
            if nid not in keep_item_ids:
                continue
            add_node(nid, n.summary_zh or n.title, "news", {
                "desc": n.summary_zh,
                "val": 2 + n.impact_score,
                "time": iso_utc(n.published_at)
            })
            if n.thread_id:
                add_link(nid, f"thread_{n.thread_id}", "关联线索")
            elif nid in selected_orphan_ids:
                rid = _nearest_report_id(n.published_at)
                if rid and rid in node_ids:
                    add_link(nid, rid, "纳入研判")

        # 5. 因果链路 (研判模式专有)：仅连接当前保留节点
        for s, t, relation in causal_pairs:
            if s in node_ids and t in node_ids:
                add_link(s, t, relation, {"type": "causal", "color": "#ffaa00", "curvature": 0.2})

    # ── [ 分支 B: 原始情报模式 ] ───────── (展现地理与隐性关联的熵值结构) ───────────
    else:
        # 隐性关联的样式 (虚线)
        impl_attr = {"dashed": True, "color": "rgba(255,255,255,0.15)"}

        # 1. 原始新闻 (释放大量实体，形成密集星系)
        for n in news_items:
            nid = f"news_{n.id}"
            # 严格使用原始抓取标题，不显示 summary_zh
            add_node(nid, n.title, "news", {
                "desc": n.content or "Raw Intel Output", 
                "val": 2.5,
                "time": iso_utc(n.published_at)
            })
            if n.locations:
                locs = sorted(n.locations, key=lambda x: (x.get("name") or ""))
                for loc in locs:
                    l_name = clean_label(loc.get('name'))
                    if l_name:
                        lid = f"loc_{l_name}"
                        add_node(lid, l_name, "location", {"val": 4})
                        add_link(nid, lid, "", impl_attr)
            if n.tags:
                for t in sorted(n.tags, key=lambda x: str(x)):
                    t_name = clean_label(t)
                    if t_name:
                        tid = f"tag_{t_name}"
                        add_node(tid, t_name, "tag", {"val": 3})
                        add_link(nid, tid, "", impl_attr)

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
                lid = f"loc_{l_name}"
                add_node(lid, l_name, "location", {"val": 4})
                add_link(eid, lid, "", impl_attr)

        # 注意：此处没有任何 thread, causal 或 report 节点

    return {
        "nodes": nodes,
        "links": links,
        "meta": {
            "window_start": iso_utc(window_start),
            "window_end": iso_utc(window_end),
            "data_coverage_start": iso_utc(window_start),
            "data_coverage_end": iso_utc(window_end),
            "report_total": len(reports_raw) if interpretation else 0,
            "report_valid": len(reports) if interpretation else 0,
            "report_filtered_failed": filtered_failed_reports if interpretation else 0,
        },
    }
