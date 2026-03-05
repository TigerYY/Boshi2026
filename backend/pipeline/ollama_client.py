"""Async wrapper around the Ollama HTTP API.

Uses requests (via asyncio.to_thread) instead of httpx because Ollama's
HTTP server returns 503 to httpx connections during model loading, while
requests/urllib handle the wait correctly.

Model strategy:
- FAST_MODEL (qwen2.5:3b): structured JSON tasks (news classification,
  summarization). Quick inference.
- ANALYSIS_MODEL (qwen3-vl:8b): complex strategic reports. CoT in 'thinking'
  field (Ollama-native separation); content field may be empty until thinking
  completes — needs high num_predict budget.
"""
import asyncio
import json
import logging
import base64
import re
import requests
from typing import Optional

logger = logging.getLogger(__name__)

OLLAMA_BASE = "http://localhost:11434"
FAST_MODEL = "qwen2.5:3b"          # for structured JSON tasks (news summarization/classification)
ANALYSIS_MODEL = "qwen3-vl:8b"     # for complex strategic analysis + image understanding
MODEL = ANALYSIS_MODEL              # backwards-compat alias

# Serialise Ollama calls by model type to prevent concurrent loading crashes
_fast_semaphore = asyncio.Semaphore(1)
_analysis_semaphore = asyncio.Semaphore(1)


def _chat_sync(messages: list[dict], temperature: float = 0.3, timeout: int = 240,
               num_predict: int = 1024, model: str = ANALYSIS_MODEL) -> str:
    """Blocking chat call — runs in a thread executor."""
    payload = {
        "model": model,
        "messages": messages,
        "stream": False,
        "keep_alive": "30m",
        "options": {
            "temperature": temperature,
            "num_predict": num_predict,
        },
    }
    resp = requests.post(
        f"{OLLAMA_BASE}/api/chat",
        json=payload,
        timeout=timeout,
    )
    resp.raise_for_status()
    data = resp.json()
    content: str = data["message"].get("content", "") or ""

    # qwen3-vl: if content is empty but 'thinking' field has content, use it
    if not content:
        thinking: str = data["message"].get("thinking", "") or ""
        if thinking:
            logger.debug("content empty, falling back to 'thinking' field")
            content = thinking.strip()

    return content


async def _chat(messages: list[dict], temperature: float = 0.3, timeout: int = 240,
                num_predict: int = 1024, model: str = ANALYSIS_MODEL) -> str:
    """Async wrapper: serialises through respective semaphore, runs in thread pool."""
    sem = _fast_semaphore if model == FAST_MODEL else _analysis_semaphore
    async with sem:
        return await asyncio.to_thread(_chat_sync, messages, temperature, timeout, num_predict, model)


def _unload_sync() -> None:
    """Ask Ollama to immediately evict the model from GPU VRAM."""
    try:
        requests.post(
            f"{OLLAMA_BASE}/api/chat",
            json={"model": MODEL, "messages": [], "keep_alive": 0},
            timeout=10,
        )
    except Exception:
        pass


async def unload_model() -> None:
    """Evict the model from GPU after a batch job completes."""
    await asyncio.to_thread(_unload_sync)


def _parse_json_from_response(raw: str) -> dict:
    """Extract the first valid JSON object from a response string."""
    raw = raw.strip()

    # Strip ```json … ``` or ``` … ```
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw)
    if fence:
        raw = fence.group(1).strip()

    # Direct parse
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    # Find first { … } block
    brace_start = raw.find("{")
    brace_end = raw.rfind("}")
    if brace_start != -1 and brace_end != -1:
        try:
            return json.loads(raw[brace_start: brace_end + 1])
        except json.JSONDecodeError:
            pass

    raise ValueError(f"No valid JSON found in response: {raw[:300]}")


def _extract_locations_from_text(text: str) -> list[dict]:
    """Keyword-based location extraction using the known-coords table.

    Replaces AI-based coordinate generation which was unreliable on small models.
    Scans the text for known place names and returns matched coordinates.
    """
    text_lower = text.lower()
    found: list[dict] = []
    seen_coords: set[tuple] = set()
    for keyword, (lat, lon) in _KNOWN_COORDS.items():
        if keyword in text_lower:
            coord_key = (round(lat, 1), round(lon, 1))
            if coord_key not in seen_coords:
                seen_coords.add(coord_key)
                found.append({"name": keyword, "lat": lat, "lon": lon})
            if len(found) >= 3:
                break
    return found


async def summarize_and_classify(title: str, content: str) -> dict:
    """
    Returns:
        summary_zh: str  (3-5 sentences in Chinese)
        category: str (airstrike|naval|land|missile|diplomacy|sanction|movement|other)
        confidence: float 0-1
        locations: list[{name, lat, lon}]  — extracted via keyword lookup, not AI
        is_breaking: bool

    Uses FAST_MODEL (qwen2.5:3b) for structured JSON output.
    Location coordinates are resolved via keyword table rather than AI generation
    to avoid hallucinated coordinates from small models.
    """
    # Simplified 3-field prompt: remove location/coordinate generation from AI scope
    example = (
        '{"summary_zh":"以色列对伊朗纳坦兹核设施实施大规模空袭，使用F-35战机携带精确制导炸弹，'
        '伊朗防空系统成功拦截部分导弹但核心设施受损。美国为此次行动提供情报支持，'
        '伊朗随即宣布进入战时状态并誓言报复。","category":"airstrike","is_breaking":true}'
    )
    prompt = (
        "你是军事情报分析师。请分析以下新闻，只返回JSON对象，不要任何其他文字。\n\n"
        "示例输出格式：\n"
        f"{example}\n\n"
        f"待分析新闻：\n标题：{title}\n"
        f"内容：{content[:1500]}\n\n"
        "只返回包含以下3个字段的JSON：\n"
        '{"summary_zh":"<3-5句连贯的中文摘要，要有军事分析视角>","category":"<从以下选一个：airstrike|naval|land|missile|diplomacy|sanction|movement|other>","is_breaking":<true或false>}\n\n'
        "规则：\n"
        "1. summary_zh必须是中文，3-5句话，包含关键军事信息\n"
        "2. is_breaking=true仅用于：直接军事打击、导弹发射、舰船交火等直接军事行动\n"
        "3. 只输出JSON，不要解释，不要markdown代码块"
    )
    raw = ""
    try:
        raw = await _chat(
            [{"role": "user", "content": prompt}],
            temperature=0.1,   # lower temperature = less hallucination
            num_predict=600,
            model=FAST_MODEL,
        )
        result = _parse_json_from_response(raw)
        result.setdefault("summary_zh", title)
        result.setdefault("category", "other")
        result.setdefault("is_breaking", False)

        # Confidence: assign by source tier based on title keywords rather than AI guessing
        source_hint = title.lower()
        if any(s in source_hint for s in ["reuters", "ap ", "bbc", "isw", "pentagon", "white house"]):
            confidence = 0.9
        elif any(s in source_hint for s in ["guardian", "nyt", "rfi", "defense", "al jazeera"]):
            confidence = 0.75
        else:
            confidence = 0.6
        result["confidence"] = confidence

        # Locations: keyword-based lookup on combined title+summary (no AI coordinate generation)
        combined_text = title + " " + content[:800] + " " + result.get("summary_zh", "")
        result["locations"] = _extract_locations_from_text(combined_text)

        return result
    except Exception as e:
        logger.error(f"summarize_and_classify error: {e} | raw={raw[:200]}")
        return {
            "summary_zh": title,
            "category": "other",
            "confidence": 0.3,
            "locations": _extract_locations_from_text(title + " " + content[:300]),
            "is_breaking": False,
        }


async def analyze_image(image_url: str) -> str:
    """Use qwen3-vl vision capability to describe a military image."""
    try:
        resp = await asyncio.to_thread(requests.get, image_url, timeout=30)
        resp.raise_for_status()
        b64 = base64.b64encode(resp.content).decode()

        prompt = (
            "You are a military image analyst. Describe this image in Chinese concisely "
            "(2-3 sentences), focusing on: military assets visible, location clues, "
            "activity type, and military significance."
        )
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
                    {"type": "text", "text": prompt},
                ],
            }
        ]
        return await _chat(messages, temperature=0.2, num_predict=256)
    except Exception as e:
        logger.warning(f"analyze_image failed for {image_url}: {e}")
        return ""


# Known strategic locations — fallback when AI returns 0,0 or out-of-region coordinates
_KNOWN_COORDS: dict[str, tuple[float, float]] = {
    # Iran nuclear / military
    "natanz":     (33.72, 51.73), "纳坦兹": (33.72, 51.73),
    "fordow":     (34.88, 50.50), "福尔多": (34.88, 50.50),
    "arak":       (34.10, 49.77), "阿拉克": (34.10, 49.77),
    "bushehr":    (28.92, 50.84), "布什尔": (28.92, 50.84),
    "isfahan":    (32.65, 51.67), "伊斯法罕": (32.65, 51.67),
    "tehran":     (35.69, 51.39), "德黑兰": (35.69, 51.39),
    "mashhad":    (36.30, 59.61), "马什哈德": (36.30, 59.61),
    "bandar":     (27.19, 56.27), "班达尔": (27.19, 56.27),
    "hormuz":     (26.58, 56.45), "霍尔木兹": (26.58, 56.45),
    # US / allied bases
    "al udeid":   (25.12, 51.31), "乌代德": (25.12, 51.31),
    "al dhafra":  (24.25, 54.55), "阿尔达芙拉": (24.25, 54.55),
    "bahrain":    (26.22, 50.59), "巴林": (26.22, 50.59),
    "kuwait":     (29.40, 47.90), "科威特": (29.40, 47.90),
    "diego garcia": (7.31, 72.42), "迭戈加西亚": (7.31, 72.42),
    # Regional hotspots
    "red sea":    (15.00, 43.00), "红海": (15.00, 43.00),
    "houthi":     (15.35, 44.20), "胡塞": (15.35, 44.20),
    "yemen":      (15.35, 44.20), "也门": (15.35, 44.20),
    "beirut":     (33.89, 35.50), "贝鲁特": (33.89, 35.50),
    "lebanon":    (33.90, 35.50), "黎巴嫩": (33.90, 35.50),
    "damascus":   (33.51, 36.29), "大马士革": (33.51, 36.29),
    "syria":      (34.80, 38.50), "叙利亚": (34.80, 38.50),
    "baghdad":    (33.33, 44.39), "巴格达": (33.33, 44.39),
    "iraq":       (33.33, 44.39), "伊拉克": (33.33, 44.39),
    "doha":       (25.30, 51.53), "多哈": (25.30, 51.53),
    "israel":     (31.77, 35.22), "以色列": (31.77, 35.22),
    "jerusalem":  (31.78, 35.22), "耶路撒冷": (31.78, 35.22), "比特谢梅什": (31.75, 35.00),
    "tel aviv":   (32.08, 34.78), "特拉维夫": (32.08, 34.78),
    "persian gulf": (26.00, 53.00), "波斯湾": (26.00, 53.00), "海湾地区": (26.00, 53.00),
    "arab sea":   (23.00, 63.00), "阿拉伯海": (23.00, 63.00),
    "oman":       (23.60, 58.59), "阿曼": (23.60, 58.59),
    "riyadh":     (24.70, 46.72), "利雅得": (24.70, 46.72),
    "saudi":      (24.70, 46.72), "沙特": (24.70, 46.72),
}

_MIDDLE_EAST_BOUNDS = dict(lat_min=10, lat_max=45, lon_min=32, lon_max=75)


def _fix_hotspot_coords(hotspot: dict) -> dict:
    """
    If an AI-generated hotspot has invalid coordinates (exactly 0,0 or outside
    the Middle East/Gulf region), look up the name in the known-coords table.
    """
    try:
        lat = float(hotspot.get("lat") or 0.0)
        lon = float(hotspot.get("lon") or 0.0)
    except (TypeError, ValueError):
        lat, lon = 0.0, 0.0
    b = _MIDDLE_EAST_BOUNDS
    in_region = b["lat_min"] <= lat <= b["lat_max"] and b["lon_min"] <= lon <= b["lon_max"]

    if in_region:
        return hotspot  # coordinates look fine

    name_lower = hotspot.get("name", "").lower()
    for keyword, (klat, klon) in _KNOWN_COORDS.items():
        if keyword in name_lower:
            hotspot = dict(hotspot, lat=klat, lon=klon)
            logger.debug("Fixed hotspot coords for '%s': 0,0 → %.2f, %.2f", hotspot["name"], klat, klon)
            return hotspot

    # Last resort: default to centre of Iran
    logger.warning("Could not resolve coords for hotspot '%s', defaulting to Iran centre", hotspot.get("name"))
    hotspot = dict(hotspot, lat=33.0, lon=53.0)
    return hotspot


async def generate_daily_summary(
    events_text: str,
    news_text: str,
    period_label: str = "今日",
    financial_text: str = "",
) -> Optional[dict]:
    """Generate a strategic battlefield summary using qwen3-vl:8b.

    Returns None when there is no meaningful input data so callers can skip
    writing a hollow report to the database.
    """
    if not (news_text or "").strip() and not (events_text or "").strip():
        logger.warning("generate_daily_summary: no input data, skipping generation")
        return None

    prompt = (
        f"You are a senior military analyst. Based on the following {period_label}战场信息，"
        "生成战场态势分析报告。用中文回答。"
        "只返回纯JSON对象，不要markdown，不要解释文字。\n\n"
        f"新闻摘要:\n{news_text[:2500]}\n\n"
        f"事件列表:\n{events_text[:1500]}\n\n"
        f"宏观金融异动(若为空则忽略):\n{financial_text}\n\n"
        "只返回如下JSON（必须用真实分析结果替换尖括号及内容，不要输出其他文字或思考过程）:\n"
        '{"summary":"<根据提供的信息生成300-400字的综合态势分析>","intensity_score":<根据局势评估的烈度分数，0.0到10.0的浮点数>,'
        '"key_developments":["<关键事件进展1>","<关键事件进展2>","<关键事件进展3>"],'
        '"hotspots":[{"name":"<热点名称>","lat":<真实纬度浮点数>,"lon":<真实经度浮点数>,"score":<该地点热度0-10>,"reason":"<热点原因描述>"}],'
        '"outlook":"<50字左右的未来局势研判>",'
        '"escalation_probability":<未来48小时战争爆发升温概率百分比0到100的浮点数>,'
        '"market_correlation":"<50字描述地缘政治与当前比特币等金融避险资产走势的关联分析判断>"}\n\n'
        "重要提示：hotspots中lat/lon必须填写真实的中东地区地理坐标（纬度10-45，经度32-75），不能使用0.0。"
    )
    raw = ""
    try:
        # Daily summary JSON needs more room: 400-word summary + hotspots
        raw = await _chat([{"role": "user", "content": prompt}], timeout=480, num_predict=8192)
        result = _parse_json_from_response(raw)
        result.setdefault("summary", "")
        result.setdefault("intensity_score", 5.0)
        result.setdefault("key_developments", [])
        result.setdefault("hotspots", [])
        result.setdefault("outlook", "")
        result.setdefault("escalation_probability", 50.0)
        result.setdefault("market_correlation", "目前地缘波动未对面盘金融产生显著溢出。")
        result["intensity_score"] = max(0.0, min(10.0, float(result["intensity_score"])))
        # Fix any 0,0 or out-of-region coordinates from the AI
        result["hotspots"] = [_fix_hotspot_coords(h) for h in result["hotspots"]]
        return result
    except Exception as e:
        logger.error(f"generate_daily_summary error: {e} | raw={raw[:300]}")
        return {
            "summary": "分析生成失败，请稍后重试。",
            "intensity_score": 5.0,
            "key_developments": [],
            "hotspots": [],
            "outlook": "",
            "escalation_probability": 0.0,
            "market_correlation": "",
        }


async def health_check() -> bool:
    try:
        resp = await asyncio.to_thread(requests.get, f"{OLLAMA_BASE}/api/tags", timeout=5)
        if resp.status_code != 200:
            return False
        tags = resp.json()
        names = [m.get("name", "") for m in tags.get("models", [])]
        # Require at least the analysis model; fast model may still be downloading
        has_analysis = any(ANALYSIS_MODEL.split(":")[0] in n for n in names)
        has_fast = any(FAST_MODEL.split(":")[0] in n for n in names)
        if not has_analysis:
            logger.warning("Ollama: analysis model %s not found", ANALYSIS_MODEL)
        if not has_fast:
            logger.warning("Ollama: fast model %s not found", FAST_MODEL)
        return has_analysis or has_fast
    except Exception:
        return False


# Alias used by processor.py
check_ollama_health = health_check
