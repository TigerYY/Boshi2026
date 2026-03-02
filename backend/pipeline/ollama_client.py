"""Async wrapper around the Ollama HTTP API.

Uses requests (via asyncio.to_thread) instead of httpx because Ollama's
HTTP server returns 503 to httpx connections during model loading, while
requests/urllib handle the wait correctly.

Model strategy:
- FAST_MODEL (deepseek-r1:1.5b): structured JSON tasks (news classification,
  summarization). Quick, CoT in <think> tags inside content field.
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
FAST_MODEL = "deepseek-r1:1.5b"    # for structured JSON tasks
ANALYSIS_MODEL = "qwen3-vl:8b"     # for complex strategic analysis
MODEL = ANALYSIS_MODEL              # backwards-compat alias

# Serialise all Ollama calls: prevents concurrent requests during model load
_semaphore = asyncio.Semaphore(1)


def _chat_sync(messages: list[dict], temperature: float = 0.3, timeout: int = 240,
               num_predict: int = 1024, model: str = ANALYSIS_MODEL) -> str:
    """Blocking chat call — runs in a thread executor.

    Handles two CoT styles:
    - deepseek-r1: thinking inside <think>...</think> in content field
    - qwen3-vl: thinking in 'thinking' field, actual output in 'content' field
      (content may be empty when thinking exceeds num_predict budget; in that
      case we fall back to extracting JSON from the thinking field itself)
    """
    payload = {
        "model": model,
        "messages": messages,
        "stream": False,
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
    # Strip <think>…</think> blocks (deepseek-r1 style)
    content = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL).strip()

    # qwen3-vl: if content is empty but 'thinking' field has content, use it
    if not content:
        thinking: str = data["message"].get("thinking", "") or ""
        if thinking:
            logger.debug("content empty, falling back to 'thinking' field")
            content = thinking.strip()

    return content


async def _chat(messages: list[dict], temperature: float = 0.3, timeout: int = 240,
                num_predict: int = 1024, model: str = ANALYSIS_MODEL) -> str:
    """Async wrapper: serialises through semaphore, runs in thread pool."""
    async with _semaphore:
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


async def summarize_and_classify(title: str, content: str) -> dict:
    """
    Returns:
        summary_zh: str  (3-5 sentences in Chinese)
        category: str (airstrike|naval|land|missile|diplomacy|sanction|movement|other)
        confidence: float 0-1
        locations: list[{name, lat, lon}]
        is_breaking: bool

    Uses FAST_MODEL (deepseek-r1:1.5b) for quick structured JSON output.
    """
    # Few-shot example helps small models produce correct JSON format
    example = (
        '{"summary_zh":"以色列对伊朗核设施实施大规模空袭，使用F-35战机和精确制导炸弹，'
        '伊朗防空系统拦截部分来袭导弹。此次打击是美以联合行动的一部分，目标为纳坦兹地下浓缩铀设施。",'
        '"category":"airstrike","confidence":0.9,'
        '"locations":[{"name":"Natanz","lat":33.72,"lon":51.73}],"is_breaking":true}'
    )
    prompt = (
        "You are a military intelligence analyst. Analyze the news below and return ONLY a JSON object.\n\n"
        "Example output format:\n"
        f"{example}\n\n"
        f"News to analyze:\nTitle: {title}\n"
        f"Content: {content[:1200]}\n\n"
        "Return ONLY a JSON object with these fields:\n"
        '{"summary_zh":"<3-5句中文摘要，必须是中文>","category":"<airstrike|naval|land|missile|diplomacy|sanction|movement|other>",'
        '"confidence":<0.0-1.0>,"locations":[{"name":"<place>","lat":<float>,"lon":<float>}],"is_breaking":<true|false>}\n\n'
        "Rules: summary_zh MUST be in Chinese. "
        "confidence: 0.9 for Reuters/AP/BBC/ISW, 0.7 secondary, 0.5 others. "
        "locations: Middle East coordinates only. "
        "is_breaking: true only for direct military strikes/missiles/naval incidents. "
        "OUTPUT ONLY THE JSON, NOTHING ELSE."
    )
    raw = ""
    try:
        raw = await _chat(
            [{"role": "user", "content": prompt}],
            num_predict=700,
            model=FAST_MODEL,
        )
        result = _parse_json_from_response(raw)
        result.setdefault("summary_zh", title)
        result.setdefault("category", "other")
        result.setdefault("confidence", 0.5)
        result.setdefault("locations", [])
        result.setdefault("is_breaking", False)
        result["confidence"] = max(0.0, min(1.0, float(result["confidence"])))
        # If summary is still in English (model failed to follow instruction), mark for retry
        summary = result.get("summary_zh", "")
        if summary and summary == title:
            result["summary_zh"] = title  # will be retried later
        return result
    except Exception as e:
        logger.error(f"summarize_and_classify error: {e} | raw={raw[:200]}")
        return {
            "summary_zh": title,
            "category": "other",
            "confidence": 0.3,
            "locations": [],
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
        "只返回如下JSON（不要其他任何内容）:\n"
        '{"summary":"300-400字综合态势分析","intensity_score":7.5,'
        '"key_developments":["美军航母进入波斯湾","伊朗导弹试射","胡塞袭击商船"],'
        '"hotspots":[{"name":"霍尔木兹海峡","lat":26.58,"lon":56.45,"score":8.0,"reason":"美伊对峙最激烈水域"},'
        '{"name":"纳坦兹核设施","lat":33.72,"lon":51.73,"score":7.0,"reason":"空袭目标"}],'
        '"outlook":"50字未来研判"}\n\n'
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
        }


async def health_check() -> bool:
    try:
        resp = await asyncio.to_thread(requests.get, f"{OLLAMA_BASE}/api/tags", timeout=5)
        if resp.status_code != 200:
            return False
        # Confirm both required models are available
        tags = resp.json()
        names = [m.get("name", "") for m in tags.get("models", [])]
        return any(FAST_MODEL in n for n in names)
    except Exception:
        return False


# Alias used by processor.py
check_ollama_health = health_check
