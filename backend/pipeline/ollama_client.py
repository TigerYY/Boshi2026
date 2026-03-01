"""Async wrapper around the Ollama HTTP API for qwen3-vl:8b.

Uses requests (via asyncio.to_thread) instead of httpx because Ollama's
HTTP server returns 503 to httpx connections during model loading, while
requests/urllib handle the wait correctly.
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
MODEL = "qwen3-vl:8b"

# Serialise all Ollama calls: prevents concurrent requests during model load
_semaphore = asyncio.Semaphore(1)


def _chat_sync(messages: list[dict], temperature: float = 0.3, timeout: int = 240, num_predict: int = 1024) -> str:
    """Blocking chat call — runs in a thread executor.

    Note: do NOT pass think=False to qwen3-vl — it causes the model to use
    all allocated tokens for hidden reasoning and return empty content.
    Ollama handles think-block stripping internally when think is unset.
    """
    payload = {
        "model": MODEL,
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
    content: str = data["message"]["content"]
    # Defensively strip any <think>…</think> blocks that may appear in content
    content = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL).strip()
    return content


async def _chat(messages: list[dict], temperature: float = 0.3, timeout: int = 240, num_predict: int = 1024) -> str:
    """Async wrapper: serialises through semaphore, runs in thread pool."""
    async with _semaphore:
        return await asyncio.to_thread(_chat_sync, messages, temperature, timeout, num_predict)


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
        summary_zh: str
        category: str (airstrike|naval|land|missile|diplomacy|sanction|movement|other)
        confidence: float 0-1
        locations: list[{name, lat, lon}]
        is_breaking: bool
    """
    prompt = (
        "You are a military intelligence analyst. Analyze the following news. "
        "Respond with ONLY a valid JSON object, no markdown, no explanation.\n\n"
        f"Title: {title}\n"
        f"Content: {content[:1500]}\n\n"
        "Return exactly this JSON (nothing else):\n"
        '{"summary_zh":"3-5句中文摘要","category":"airstrike|naval|land|missile|diplomacy|sanction|movement|other",'
        '"confidence":0.0,"locations":[{"name":"地名","lat":0.0,"lon":0.0}],"is_breaking":false}\n\n'
        "Rules:\n"
        "- confidence: 0.9 for Reuters/AP/BBC/ISW, 0.7 for secondary, 0.5 for others\n"
        "- locations: only real Middle East places with known lat/lon coordinates\n"
        "- is_breaking: true only for direct military action (strikes, missiles, naval incidents)\n"
        "- RETURN ONLY THE JSON OBJECT"
    )
    raw = ""
    try:
        # JSON response is compact; 512 tokens is ample
        raw = await _chat([{"role": "user", "content": prompt}], num_predict=512)
        result = _parse_json_from_response(raw)
        result.setdefault("summary_zh", title)
        result.setdefault("category", "other")
        result.setdefault("confidence", 0.5)
        result.setdefault("locations", [])
        result.setdefault("is_breaking", False)
        result["confidence"] = max(0.0, min(1.0, float(result["confidence"])))
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


async def generate_daily_summary(
    events_text: str,
    news_text: str,
    period_label: str = "今日",
) -> dict:
    """Generate a strategic battlefield summary using qwen3-vl:8b."""
    prompt = (
        f"You are a senior military analyst. Based on the following {period_label}战场信息，"
        "生成战场态势分析报告。用中文回答。"
        "只返回纯JSON对象，不要markdown，不要解释文字。\n\n"
        f"新闻摘要:\n{news_text[:2500]}\n\n"
        f"事件列表:\n{events_text[:1500]}\n\n"
        "只返回如下JSON（不要其他任何内容）:\n"
        '{"summary":"300-400字综合态势分析","intensity_score":5.0,'
        '"key_developments":["要点1","要点2","要点3"],'
        '"hotspots":[{"name":"地区","lat":0.0,"lon":0.0,"score":5.0,"reason":"原因"}],'
        '"outlook":"50字未来研判"}'
    )
    raw = ""
    try:
        # Daily summary JSON needs more room: 400-word summary + hotspots
        raw = await _chat([{"role": "user", "content": prompt}], timeout=300, num_predict=2048)
        result = _parse_json_from_response(raw)
        result.setdefault("summary", "")
        result.setdefault("intensity_score", 5.0)
        result.setdefault("key_developments", [])
        result.setdefault("hotspots", [])
        result.setdefault("outlook", "")
        result["intensity_score"] = max(0.0, min(10.0, float(result["intensity_score"])))
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
        return resp.status_code == 200
    except Exception:
        return False
