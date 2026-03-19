"""LLM client: LM Studio (OpenAI-compatible) first, Ollama fallback.

Uses requests (via asyncio.to_thread) instead of httpx because Ollama's
HTTP server returns 503 to httpx connections during model loading, while
requests/urllib handle the wait correctly.

Model strategy (Ollama path):
- FAST_MODEL / ANALYSIS_MODEL (Qwen3.5-35B-A3B:latest): unified text model
  for structured JSON tasks and strategic reports.
- VISION_MODEL (qwen3-vl:8b): optional vision model for image tasks.

LM Studio path: single LM_STUDIO_MODEL for all text chat; vision tasks use
Ollama only (analyze_image).
"""
import asyncio
import json
import logging
import base64
import re
import requests
from typing import Optional, Any, Dict
import time

import os

logger = logging.getLogger(__name__)

FAILED_REPORT_TEXT = "分析生成失败，请稍后重试。"

# Prefer IPv4 loopback to avoid IPv6 localhost resolution issues on some hosts.
def _normalize_to_ipv4(url: str) -> str:
    url = (url or "").strip()
    if not url:
        return url
    url = url.replace("http://localhost:", "http://127.0.0.1:")
    url = url.replace("https://localhost:", "https://127.0.0.1:")
    url = url.replace("http://[::1]:", "http://127.0.0.1:")
    url = url.replace("https://[::1]:", "https://127.0.0.1:")
    return url


# Use environment variable for Ollama host to support remote LLM deployment.
OLLAMA_HOST = _normalize_to_ipv4(os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434")).rstrip("/")
OLLAMA_BASE = OLLAMA_HOST

# LM Studio OpenAI-compatible API (default port 1234).
LM_STUDIO_BASE = _normalize_to_ipv4(os.getenv("LM_STUDIO_BASE", "http://127.0.0.1:1234/v1")).rstrip("/")
# Must match the local LM Studio loaded model id.
LM_STUDIO_MODEL = os.getenv("LM_STUDIO_MODEL", "qwen/qwen3.5-35b-a3b")

# Optional: override Ollama context length if your server supports it.
_OLLAMA_NUM_CTX: Optional[int] = None
_OLLAMA_NUM_CTX_RAW = (os.getenv("OLLAMA_NUM_CTX", "") or "").strip()
if _OLLAMA_NUM_CTX_RAW:
    try:
        _OLLAMA_NUM_CTX = int(_OLLAMA_NUM_CTX_RAW)
    except ValueError:
        logger.warning("Invalid OLLAMA_NUM_CTX=%r, ignoring", _OLLAMA_NUM_CTX_RAW)
# lm_studio | ollama | auto
# auto: Ollama-first, then LM Studio fallback (recommended for single-service local setups).
LLM_PRIMARY = os.getenv("LLM_PRIMARY", "auto").strip().lower()

# Force LM Studio as the only inference backend (disables Ollama fallback).
LM_STUDIO_ONLY = os.getenv("LM_STUDIO_ONLY", "0").strip().lower() in {"1", "true", "yes", "on"}

def _safe_env_int(name: str, default: int) -> int:
    raw = os.getenv(name, str(default))
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default

PROVIDER_FAILOVER_THRESHOLD = max(1, _safe_env_int("PROVIDER_FAILOVER_THRESHOLD", 2))
PROVIDER_FAILOVER_COOLDOWN_SEC = max(5, _safe_env_int("PROVIDER_FAILOVER_COOLDOWN_SEC", 45))

OLLAMA_TEXT_MODEL = os.getenv("OLLAMA_TEXT_MODEL", "Qwen3.5-35B-A3B:latest").strip()
OLLAMA_VISION_MODEL = os.getenv("OLLAMA_VISION_MODEL", "qwen3-vl:8b").strip()

FAST_MODEL = OLLAMA_TEXT_MODEL      # unified text model for structured JSON tasks
ANALYSIS_MODEL = OLLAMA_TEXT_MODEL  # unified text model for complex strategic analysis
VISION_MODEL = OLLAMA_VISION_MODEL  # dedicated vision model when available in Ollama
MODEL = ANALYSIS_MODEL              # backwards-compat alias

# Serialise Ollama calls by model type to prevent concurrent loading crashes
_text_semaphore = asyncio.Semaphore(1)
_vision_semaphore = asyncio.Semaphore(1)

_lm_studio_model_runtime: Optional[str] = None
_ollama_vision_runtime_cache: dict[str, float | bool] = {"value": False, "expires_at": 0.0}
_provider_runtime_state: dict[str, dict[str, float | int]] = {
    "ollama": {"fail_count": 0, "cooldown_until": 0.0},
    "lm_studio": {"fail_count": 0, "cooldown_until": 0.0},
}


def _get_effective_lm_studio_model_id_sync() -> str:
    """
    Resolve LM Studio model id from /models and cache it.

    This fixes cases where LM_STUDIO_MODEL env var doesn't exactly match the
    actual loaded model id (case/alias differences).
    """
    global _lm_studio_model_runtime
    if _lm_studio_model_runtime:
        return _lm_studio_model_runtime
    ok, mid = _check_lm_studio_models_sync()
    _lm_studio_model_runtime = mid if (ok and mid) else LM_STUDIO_MODEL
    return _lm_studio_model_runtime


def _provider_order(ollama_only: bool) -> list[str]:
    """
    Decide backend priority for current request.
    Returns a list like ["ollama", "lm_studio"].
    """
    if LM_STUDIO_ONLY:
        return ["lm_studio"]
    if ollama_only:
        return ["ollama"]
    primary = (LLM_PRIMARY or "auto").strip().lower()
    if primary == "lm_studio":
        return ["lm_studio", "ollama"]
    if primary == "ollama":
        return ["ollama", "lm_studio"]
    # auto (default): Ollama first, LM Studio fallback.
    order = ["ollama", "lm_studio"]
    # Adaptive reorder: if primary is in cooldown, temporarily prefer the backup.
    if _is_provider_in_cooldown(order[0]) and not _is_provider_in_cooldown(order[1]):
        return [order[1], order[0]]
    return order


def _is_provider_in_cooldown(provider: str) -> bool:
    st = _provider_runtime_state.get(provider)
    if not st:
        return False
    return float(st.get("cooldown_until", 0.0)) > time.time()


def _record_provider_success(provider: str) -> None:
    st = _provider_runtime_state.get(provider)
    if not st:
        return
    st["fail_count"] = 0
    st["cooldown_until"] = 0.0


def _record_provider_failure(provider: str) -> None:
    st = _provider_runtime_state.get(provider)
    if not st:
        return
    fail_count = int(st.get("fail_count", 0)) + 1
    st["fail_count"] = fail_count
    if fail_count >= PROVIDER_FAILOVER_THRESHOLD:
        st["cooldown_until"] = time.time() + PROVIDER_FAILOVER_COOLDOWN_SEC


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError:
        logger.warning("Invalid int env %s=%r, use default %d", name, raw, default)
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return float(raw)
    except ValueError:
        logger.warning("Invalid float env %s=%r, use default %f", name, raw, default)
        return default


def _task_profile(task: str) -> dict[str, Any]:
    """
    Centralized generation parameters per task.
    Keep defaults tuned for "balanced" stability.
    """
    # Shared defaults
    if task == "fast_json":
        return {
            "temperature": _env_float("FAST_JSON_TEMPERATURE", 0.1),
            "num_predict": _env_int("FAST_JSON_NUM_PREDICT", 800),
            "timeout": _env_int("FAST_JSON_TIMEOUT", 240),
            "format": "json",
        }
    if task == "osint_json":
        return {
            "temperature": _env_float("OSINT_TEMPERATURE", 0.15),
            "num_predict": _env_int("OSINT_NUM_PREDICT", 1400),
            "timeout": _env_int("OSINT_TIMEOUT", 300),
            "format": "json",
        }
    if task == "daily_summary":
        return {
            "temperature": _env_float("DAILY_TEMPERATURE", 0.2),
            "num_predict": _env_int("DAILY_NUM_PREDICT", 8192),
            "timeout": _env_int("DAILY_TIMEOUT", 480),
            "format": "json",
        }
    if task == "image_analysis":
        return {
            "temperature": _env_float("IMAGE_TEMPERATURE", 0.2),
            "num_predict": _env_int("IMAGE_NUM_PREDICT", 512),
            "timeout": _env_int("IMAGE_TIMEOUT", 120),
            "fetch_timeout": _env_int("IMAGE_FETCH_TIMEOUT", 30),
        }
    if task == "threads_json":
        return {
            "temperature": _env_float("THREADS_TEMPERATURE", 0.1),
            "num_predict": _env_int("THREADS_NUM_PREDICT", 2000),
            "timeout": _env_int("THREADS_TIMEOUT", 240),
            "format": "json",
        }
    if task == "causal_links_json":
        return {
            "temperature": _env_float("CAUSAL_TEMPERATURE", 0.1),
            "num_predict": _env_int("CAUSAL_NUM_PREDICT", 1000),
            "timeout": _env_int("CAUSAL_TIMEOUT", 240),
            "format": "json",
        }
    # fallback: balanced
    return {
        "temperature": 0.2,
        "num_predict": 1024,
        "timeout": 240,
    }


def _chat_lm_studio_sync(
    messages: list[dict],
    temperature: float,
    timeout: int,
    max_tokens: int,
    model: str,
    format_json: bool,
) -> dict:
    """POST /v1/chat/completions — returns {"content", "thinking": ""}."""
    base_payload: Dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max(1, min(max_tokens, 131072)),
        "stream": False,
    }
    if format_json:
        attempts = (
            ({**base_payload, "response_format": {"type": "json_object"}}, True),
            (base_payload, False),
        )
    else:
        attempts = ((base_payload, False),)
    last_err: Optional[Exception] = None
    for payload, _ in attempts:
        adaptive_payload = dict(payload)
        adaptive_retries = 0
        while True:
            resp = requests.post(
                f"{LM_STUDIO_BASE}/chat/completions",
                json=adaptive_payload,
                timeout=timeout,
            )
            if resp.status_code == 400 and format_json and "response_format" in adaptive_payload:
                last_err = requests.HTTPError(
                    f"LM Studio HTTP {resp.status_code}: {resp.text[:200]!r}"
                )
                break

            # Auto-shrink max_tokens when LM Studio says context budget is exceeded.
            if resp.status_code == 400 and "Context size has been exceeded" in (resp.text or ""):
                cur_mt = int(adaptive_payload.get("max_tokens") or 0)
                if cur_mt > 128 and adaptive_retries < 3:
                    adaptive_payload["max_tokens"] = max(128, cur_mt // 2)
                    adaptive_retries += 1
                    logger.warning(
                        "LM Studio context exceeded, retry with max_tokens=%s",
                        adaptive_payload["max_tokens"],
                    )
                    continue

            if resp.status_code >= 500:
                resp.raise_for_status()
            if resp.status_code >= 400:
                raise requests.HTTPError(
                    f"LM Studio HTTP {resp.status_code}: {resp.text[:300]!r}"
                )
            data = resp.json()
            choices = data.get("choices") or []
            if not choices:
                raise ValueError("LM Studio: empty choices")
            msg = choices[0].get("message") or {}
            content = (msg.get("content") or "") or ""
            # Some reasoning models configured with "separate reasoning_content" may
            # return the final answer inside `reasoning_content` while `content` is empty.
            reasoning_content = (msg.get("reasoning_content") or "") or ""
            if content:
                return {"content": content, "thinking": ""}
            return {"content": "", "thinking": reasoning_content}
    if last_err:
        raise last_err
    raise RuntimeError("LM Studio: no completion attempts")


def _chat_ollama_sync(
    messages: list[dict],
    temperature: float = 0.3,
    timeout: int = 240,
    num_predict: int = 1024,
    model: str = ANALYSIS_MODEL,
    format: str = None,
) -> dict:
    """Blocking Ollama chat — returns a dict with 'content' and 'thinking'."""
    payload: Dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": False,
        "keep_alive": "30m",
        "options": {
            "temperature": temperature,
            "num_predict": num_predict,
        },
    }
    # Avoid sending incompatible/null fields (some Ollama versions are strict).
    if format is not None:
        payload["format"] = format
    if _OLLAMA_NUM_CTX is not None:
        payload["options"]["num_ctx"] = _OLLAMA_NUM_CTX
    resp = requests.post(
        f"{OLLAMA_BASE}/api/chat",
        json=payload,
        timeout=timeout,
    )
    resp.raise_for_status()
    data = resp.json()
    msg = data.get("message", {})
    content: str = msg.get("content", "") or ""
    thinking: str = msg.get("thinking", "") or ""

    return {"content": content, "thinking": thinking}


def _chat_unified_sync(
    messages: list[dict],
    temperature: float = 0.3,
    timeout: int = 240,
    num_predict: int = 1024,
    model: str = ANALYSIS_MODEL,
    format: str = None,
    *,
    ollama_only: bool = False,
) -> dict:
    order = _provider_order(ollama_only)
    last_err: Optional[Exception] = None

    for provider in order:
        try:
            if provider == "ollama":
                result = _chat_ollama_sync(messages, temperature, timeout, num_predict, model, format)
                _record_provider_success("ollama")
                return result
            result = _chat_lm_studio_sync(
                messages,
                temperature,
                timeout,
                num_predict,
                _get_effective_lm_studio_model_id_sync(),
                format_json=(format == "json"),
            )
            _record_provider_success("lm_studio")
            return result
        except Exception as e:
            last_err = e
            _record_provider_failure(provider)
            # Single-provider mode should fail immediately.
            if len(order) == 1:
                raise
            logger.warning("%s failed, trying next provider: %s", provider, e)

    if last_err:
        raise last_err
    raise RuntimeError("No available LLM provider")


async def _chat(
    messages: list[dict],
    temperature: float = 0.3,
    timeout: int = 240,
    num_predict: int = 1024,
    model: str = ANALYSIS_MODEL,
    format: str = None,
    *,
    ollama_only: bool = False,
) -> dict:
    """Async wrapper: returns dict {"content": str, "thinking": str}."""
    sem = _vision_semaphore if model == VISION_MODEL else _text_semaphore
    async with sem:
        return await asyncio.to_thread(
            lambda: _chat_unified_sync(
                messages,
                temperature,
                timeout,
                num_predict,
                model,
                format,
                ollama_only=ollama_only,
            )
        )


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
    """
    Extract the last valid JSON object/array from a response string.

    This is more robust for "reasoning_content" outputs where the prompt
    itself may contain example JSON objects (we want the *model answer*,
    which is usually the last JSON block in the text).
    """
    raw = (raw or "").strip()

    # Strip ```json … ``` or ``` … ```
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw)
    if fence:
        raw = fence.group(1).strip()

    # Direct parse
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    def _find_matching_bracket(s: str, start_idx: int, open_ch: str, close_ch: str) -> Optional[str]:
        depth = 0
        in_string = False
        escape = False
        for i in range(start_idx, len(s)):
            ch = s[i]
            if in_string:
                if escape:
                    escape = False
                elif ch == "\\":
                    escape = True
                elif ch == '"':
                    in_string = False
                continue
            if ch == '"':
                in_string = True
                continue
            if ch == open_ch:
                depth += 1
            elif ch == close_ch:
                depth -= 1
                if depth == 0:
                    return s[start_idx : i + 1]
        return None

    def _try_last(start_ch: str, end_ch: str) -> Optional[Any]:
        start_idx = raw.rfind(start_ch)
        while start_idx != -1:
            candidate = _find_matching_bracket(raw, start_idx, start_ch, end_ch)
            if candidate:
                try:
                    return json.loads(candidate)
                except json.JSONDecodeError:
                    pass
            start_idx = raw.rfind(start_ch, 0, start_idx)
        return None

    # Try the later start first (object vs array).
    last_obj = raw.rfind("{")
    last_arr = raw.rfind("[")
    order: list[tuple[str, str, int]] = []
    if last_obj != -1:
        order.append(("{", "}", last_obj))
    if last_arr != -1:
        order.append(("[", "]", last_arr))
    order.sort(key=lambda x: x[2], reverse=True)

    for open_ch, close_ch, _ in order:
        obj = _try_last(open_ch, close_ch)
        if obj is not None:
            return obj

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

    Uses FAST_MODEL (Qwen3.5-35B-A3B:latest) for structured JSON output.
    Location coordinates are resolved via keyword table rather than AI generation
    to avoid hallucinated coordinates from small models.
    """
    # Simplified 3-field prompt: remove location/coordinate generation from AI scope
    example = (
        '{"summary_zh":"以色列对伊朗纳坦兹核设施实施大规模空袭，使用F-35战机携带精确制导炸弹，'
        '伊朗防空系统成功拦截部分导弹但核心设施受损。美国为此次行动提供情报支持，'
        '伊朗随即宣布进入战时状态并誓言报复。","category":"airstrike","is_breaking":true,'
        '"tags":["F-35战机","纳坦兹核设施","防空系统"],"impact_score":8.5}'
    )
    prompt = (
        "你是军事情报分析师。请分析以下新闻，只返回JSON对象，不要任何其他文字。\n\n"
        "示例输出格式：\n"
        f"{example}\n\n"
        f"待分析新闻：\n标题：{title}\n"
        f"内容：{content[:1500]}\n\n"
        "只返回包含以下5个字段的JSON：\n"
        '{"summary_zh":"<3-5句连贯的中文摘要，要有军事分析视角>","category":"<从以下选一个：airstrike|naval|land|missile|diplomacy|sanction|movement|other>","is_breaking":<true或false>,"tags":["<核心关键词1>","<关键词2>"],"impact_score":<1-10的战略影响力分数，浮点数>}\n\n'
        "规则：\n"
        "1. summary_zh必须是中文，3-5句话，包含关键军事信息\n"
        "2. tags数组提取文中关键武器型号、战略地点或组织（最多4个，纯中文，如：'卡西姆苏莱曼尼','波斯湾','巡航导弹'）\n"
        "3. impact_score评估标准：1-3普通新闻，4-6区域动态，7-8重度冲突/外交突破，9-10全面战争风险\n"
        "4. is_breaking=true仅用于：直接军事打击、导弹发射、舰船交火等直接军事行动\n"
        "5. 只输出JSON，不要解释，不要markdown代码块"
    )
    res = {"content": "", "thinking": ""}
    prof = _task_profile("fast_json")
    try:
        res = await _chat(
            [{"role": "user", "content": prompt}],
            temperature=prof["temperature"],
            num_predict=prof["num_predict"],
            timeout=prof["timeout"],
            model=FAST_MODEL,
            format=prof.get("format"),
        )
        raw = res["content"] or res["thinking"]
        result = _parse_json_from_response(raw)
        result.setdefault("summary_zh", title)
        result.setdefault("category", "other")
        result.setdefault("is_breaking", False)
        result.setdefault("impact_score", 3.0)
        result.setdefault("tags", [])
        
        # 移除之前的 Tags 拼接逻辑，保持摘要纯净

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
        logger.error(f"summarize_and_classify error: {e} | raw={res['content'][:200]}")
        return {
            "summary_zh": title,
            "category": "other",
            "confidence": 0.3,
            "locations": _extract_locations_from_text(title + " " + content[:300]),
            "is_breaking": False,
        }


def _extract_final_text_from_reasoning(text: str) -> str:
    """
    For reasoning models with separate `reasoning_content`,
    the final user-facing answer is sometimes embedded after a marker.
    """
    if not text:
        return ""
    for marker in ["Output:", "输出：", "最终输出：", "Final Output:", "Final Answer:", "最终答案："]:
        idx = text.rfind(marker)
        if idx != -1:
            tail = text[idx + len(marker) :].strip()
            if "\n" in tail:
                tail = tail.splitlines()[0].strip()
            return tail
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    return lines[-1] if lines else text.strip()


def _extract_json_segment_near_output(text: str) -> Optional[dict]:
    """
    Best-effort JSON extraction from reasoning-style outputs that include
    markers like "Output:" / "Final Output:".
    """
    if not text:
        return None
    markers = ["Output:", "输出：", "最终输出：", "Final Output:", "Final Answer:", "最终答案："]
    for marker in markers:
        idx = text.rfind(marker)
        if idx == -1:
            continue
        tail = text[idx + len(marker) :].strip()
        if not tail:
            continue
        try:
            return _parse_json_from_response(tail)
        except Exception:
            continue
    return None


def _has_ollama_vision_model_sync() -> bool:
    """
    Cached check for Ollama vision model availability.
    """
    now = time.time()
    cached_exp = float(_ollama_vision_runtime_cache.get("expires_at", 0.0))
    if now < cached_exp:
        return bool(_ollama_vision_runtime_cache.get("value", False))
    try:
        resp = requests.get(f"{OLLAMA_BASE}/api/tags", timeout=5)
        resp.raise_for_status()
        tags = resp.json()
        names = [str(m.get("name", "")) for m in tags.get("models", [])]
        prefix = VISION_MODEL.split(":")[0].lower()
        has_vision = any(prefix in n.lower() for n in names)
        _ollama_vision_runtime_cache["value"] = has_vision
        _ollama_vision_runtime_cache["expires_at"] = now + 15.0
        return has_vision
    except Exception:
        _ollama_vision_runtime_cache["value"] = False
        _ollama_vision_runtime_cache["expires_at"] = now + 5.0
        return False


async def analyze_image(image_url: str) -> str:
    """Use qwen3-vl vision capability to describe a military image."""
    try:
        prof = _task_profile("image_analysis")
        resp = await asyncio.to_thread(
            requests.get,
            image_url,
            timeout=prof["fetch_timeout"],
        )
        resp.raise_for_status()
        b64 = base64.b64encode(resp.content).decode()
        content_type = (resp.headers.get("Content-Type") or "").split(";")[0].strip().lower() or "image/jpeg"
        if not content_type.startswith("image/"):
            content_type = "image/jpeg"

        prompt = (
            "You are a military image analyst. Describe this image in Chinese concisely "
            "(2-3 sentences), focusing on: military assets visible, location clues, "
            "activity type, and military significance."
        )
        # Prefer Ollama vision model when available; otherwise route directly to
        # LM Studio multimodal to avoid guaranteed text-model mismatch in Ollama.
        has_vision = await asyncio.to_thread(_has_ollama_vision_model_sync)
        if has_vision:
            # Ollama vision expects `images` on the message, not OpenAI content array.
            res = await asyncio.to_thread(
                lambda: _chat_ollama_sync(
                    messages=[{"role": "user", "content": prompt, "images": [b64]}],
                    temperature=prof["temperature"],
                    timeout=prof["timeout"],
                    num_predict=prof["num_predict"],
                    model=VISION_MODEL,
                    format=None,
                )
            )
        else:
            # LM Studio multimodal uses OpenAI-compatible content array.
            res = await asyncio.to_thread(
                lambda: _chat_lm_studio_sync(
                    [
                        {
                            "role": "user",
                            "content": [
                                {"type": "image_url", "image_url": {"url": f"data:{content_type};base64,{b64}"}},
                                {"type": "text", "text": prompt},
                            ],
                        }
                    ],
                    prof["temperature"],
                    prof["timeout"],
                    prof["num_predict"],
                    _get_effective_lm_studio_model_id_sync(),
                    format_json=False,
                )
            )
        text = (res["content"] or res["thinking"] or "").strip()
        return _extract_final_text_from_reasoning(text)
    except Exception as e:
        logger.warning(f"analyze_image failed for {image_url}: {e}")
        return ""


# Known strategic locations — fallback when AI returns 0,0 or out-of-region coordinates
_KNOWN_COORDS: dict[str, tuple[float, float]] = {
    # Iran nuclear / military / regional
    "natanz":     (33.72, 51.73), "纳坦兹": (33.72, 51.73),
    "fordow":     (34.88, 50.50), "福尔多": (34.88, 50.50),
    "arak":       (34.10, 49.77), "阿拉克": (34.10, 49.77),
    "bushehr":    (28.92, 50.84), "布什尔": (28.92, 50.84),
    "isfahan":    (32.65, 51.67), "伊斯法罕": (32.65, 51.67),
    "tehran":     (35.69, 51.39), "德黑兰": (35.69, 51.39),
    "mashhad":    (36.30, 59.61), "马什哈德": (36.30, 59.61),
    "bandar":     (27.19, 56.27), "班达尔": (27.19, 56.27), "阿巴斯港": (27.19, 56.27),
    "tabriz":     (38.08, 46.29), "大不里士": (38.08, 46.29),
    "kermanshah": (34.31, 47.06), "克尔曼沙赫": (34.31, 47.06),
    "shiraz":     (29.59, 52.58), "设拉子": (29.59, 52.58),
    "hormuz":     (26.58, 56.45), "霍尔木兹": (26.58, 56.45),
    
    # US / allied bases & Gulf States
    "al udeid":   (25.12, 51.31), "乌代德": (25.12, 51.31),
    "al dhafra":  (24.25, 54.55), "阿尔达芙拉": (24.25, 54.55),
    "bahrain":    (26.22, 50.59), "巴林": (26.22, 50.59), "麦纳麦": (26.22, 50.59),
    "kuwait":     (29.40, 47.90), "科威特": (29.40, 47.90),
    "diego garcia": (7.31, 72.42), "迭戈加西亚": (7.31, 72.42),
    "riyadh":     (24.70, 46.72), "利雅得": (24.70, 46.72),
    "saudi":      (24.70, 46.72), "沙特": (24.70, 46.72),
    "jeddah":     (21.48, 39.19), "吉达": (21.48, 39.19),
    "uae":        (24.45, 54.37), "阿联酋": (24.45, 54.37), "阿布扎比": (24.45, 54.37),
    "doha":       (25.30, 51.53), "多哈": (25.30, 51.53),
    "oman":       (23.60, 58.59), "阿曼": (23.60, 58.59), "马斯喀特": (23.58, 58.40),

    # Levant Hotspots (Israel, Palestine, Lebanon, Syria, Jordan)
    "israel":     (31.77, 35.22), "以色列": (31.77, 35.22),
    "jerusalem":  (31.78, 35.22), "耶路撒冷": (31.78, 35.22), "比特谢梅什": (31.75, 35.00),
    "tel aviv":   (32.08, 34.78), "特拉维夫": (32.08, 34.78),
    "haifa":      (32.79, 34.98), "海法": (32.79, 34.98),
    "eilat":      (29.55, 34.95), "埃拉特": (29.55, 34.95),
    "golan":      (33.00, 35.75), "戈兰高地": (33.00, 35.75),
    "gaza":       (31.50, 34.46), "加沙": (31.50, 34.46),
    "rafah":      (31.28, 34.24), "拉法": (31.28, 34.24),
    "west bank":  (32.00, 35.25), "约旦河西岸": (32.00, 35.25), "杰宁": (32.46, 35.29),
    "beirut":     (33.89, 35.50), "贝鲁特": (33.89, 35.50),
    "lebanon":    (33.90, 35.50), "黎巴嫩": (33.90, 35.50),
    "tyre":       (33.27, 35.20), "提尔": (33.27, 35.20),
    "damascus":   (33.51, 36.29), "大马士革": (33.51, 36.29),
    "syria":      (34.80, 38.50), "叙利亚": (34.80, 38.50),
    "aleppo":     (36.20, 37.13), "阿勒颇": (36.20, 37.13),
    "homs":       (34.73, 36.71), "霍姆斯": (34.73, 36.71),
    "amman":      (31.94, 35.92), "安曼": (31.94, 35.92), "约旦": (31.94, 35.92),
    
    # Iraq & Yemen 
    "baghdad":    (33.33, 44.39), "巴格达": (33.33, 44.39),
    "iraq":       (33.33, 44.39), "伊拉克": (33.33, 44.39),
    "erbil":      (36.19, 44.01), "埃尔比勒": (36.19, 44.01),
    "basra":      (30.50, 47.81), "巴士拉": (30.50, 47.81),
    "yemen":      (15.35, 44.20), "也门": (15.35, 44.20),
    "houthi":     (15.35, 44.20), "胡塞": (15.35, 44.20),
    "sanaa":      (15.36, 44.19), "萨那": (15.36, 44.19),
    "hodeidah":   (14.79, 42.95), "荷台达": (14.79, 42.95),
    "aden":       (12.79, 45.03), "亚丁": (12.79, 45.03),
    
    # Strategic Waters
    "red sea":    (15.00, 43.00), "红海": (15.00, 43.00),
    "persian gulf": (26.00, 53.00), "波斯湾": (26.00, 53.00), "海湾地区": (26.00, 53.00),
    "arab sea":   (23.00, 63.00), "阿拉伯海": (23.00, 63.00),
    "mediterranean": (33.50, 32.00), "地中海": (33.50, 32.00),
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
        f"你是一个拥有顶级战略视野的军事情报高级顾问。基于以下【{period_label}】获取的碎片化战场数据，\n"
        "你需要通过全局维度对当前战局进行复盘、关联及深度趋势研判。请用简体中文撰写报告。\n\n"
        "【深度分析框架】\n"
        "1. **战场因果链合成**：不仅要总结发生了什么，更要分析其背后的战略意图。例如，航母的位移是否是为了配合特定的外交制裁？\n"
        "2. **宏观关联属性**：重点分析军事动作对金融避险市场（BTC）及能源价格（原油）的耦合压力。\n"
        "3. **确定性预警**：outlook 字段必须包含对未来 48 小时内最具风险的 1 个具体维度的明确预警。\n"
        "4. **禁止泄露指令**：报告内容严禁提及任何关于 JSON 格式、任务要求、系统角色等元指令文字，直接输出专业的判读内容。\n\n"
        "【待研判解密数据】\n"
        f"1. 原始新闻摘要：\n{news_text[:_env_int('DAILY_NEWS_CHARS', 2500)]}\n\n"
        f"2. 确证军事事件：\n{events_text[:_env_int('DAILY_EVENTS_CHARS', 1500)]}\n\n"
        f"3. 宏观避险及大宗商品波动：\n{financial_text[:_env_int('DAILY_FINANCE_CHARS', 1200)]}\n\n"
        "只返回如下 JSON 格式，不要包含任何思考过程或解释（必须用真实深度分析结果替换尖括号内容）：\n"
        '{"summary":"<300字左右的高密度综述，遵循：总览-核心动作-战略意图链条>","intensity_score":<烈度评分0.0-10.0>,'
        '"key_developments":["<关键进展1：因果关系描述>","<关键进展2：因果关系描述>","<关键进展3：因果关系描述>"],'
        '"hotspots":[{"name":"<热点名称>","lat":<纬度>,"lon":<经度>,"score":<热度>,"reason":"<聚焦该地点的军事/地缘意义分析>"}],'
        '"outlook":"<未来 48 小时核心演变预测与关键红线预警记录>",'
        '"escalation_probability":<冲突升级概率 0-100>,'
        '"market_correlation":"<地缘动作对当前加密货币及石油市场的具体情绪波动传导分析判断>",'
        '"abu_dhabi_risk":<阿联酋安全风险评分 0-100>,'
        '"abu_dhabi_status":"<评估阿联酋在中东当前乱局中的受波及程度与防御状态评价>",'
        '"forecast_data":{"24h": <概率>, "48h": <概率>, "72h": <概率>}}\n\n'
        "重要：hotspots 中必须包含至少一个最具战略意义的地理节点坐标（纬度 10-45，经度 32-75）。"
    )
    def _classify_summary_error(exc: Exception) -> str:
        s = str(exc or "")
        sl = s.lower()
        if "context size has been exceeded" in sl:
            return "context_exceeded"
        if "timed out" in sl or "timeout" in sl:
            return "timeout"
        if "no valid json found" in sl:
            return "json_parse_failed"
        if "connection" in sl or "refused" in sl:
            return "lmstudio_unreachable"
        if "http 5" in sl:
            return "provider_5xx"
        return "unknown_error"

    res = {"content": "", "thinking": ""}
    try:
        prof = _task_profile("daily_summary")
        # Daily summary JSON needs more room: 400-word summary + hotspots
        res = await _chat(
            [{"role": "user", "content": prompt}],
            temperature=prof["temperature"],
            timeout=prof["timeout"],
            num_predict=prof["num_predict"],
            format=prof.get("format"),
        )
        logger.info("Daily summary raw content length: %d, thinking length: %d", len(res["content"]), len(res["thinking"]))
        raw = res["content"] or res["thinking"]
        try:
            result = _parse_json_from_response(raw)
        except Exception:
            # Retry with a tighter budget to reduce reasoning spillover.
            retry_num_predict = max(1200, min(int(prof["num_predict"]), 4096))
            retry_timeout = min(int(prof["timeout"]), 240)
            retry_res = await _chat(
                [{"role": "user", "content": prompt + "\n\n仅返回JSON对象，不要任何解释或前后缀。"}],
                temperature=min(float(prof["temperature"]), 0.15),
                timeout=retry_timeout,
                num_predict=retry_num_predict,
                format=prof.get("format"),
            )
            raw = retry_res["content"] or retry_res["thinking"]
            res = retry_res
            result = _parse_json_from_response(raw)
        result.setdefault("summary", "")
        result.setdefault("intensity_score", 5.0)
        result.setdefault("key_developments", [])
        result.setdefault("hotspots", [])
        result.setdefault("outlook", "")
        result.setdefault("escalation_probability", 50.0)
        result.setdefault("market_correlation", "目前地缘波动未对面盘金融产生显著溢出。")
        result.setdefault("abu_dhabi_risk", 10.0)
        result.setdefault("abu_dhabi_status", "阿联酋本土目前维持日常警戒，未受周边冲突直接波及。")
        result.setdefault("forecast_data", {"24h": 50.0, "48h": 50.0, "72h": 50.0})

        result["thinking_process"] = res["thinking"]
        result["intensity_score"] = max(0.0, min(10.0, float(result["intensity_score"])))
        # Fix any 0,0 or out-of-region coordinates from the AI
        result["hotspots"] = [_fix_hotspot_coords(h) for h in result["hotspots"]]
        # Embed report validity metadata for graph filtering/observability.
        fd = result.get("forecast_data") if isinstance(result.get("forecast_data"), dict) else {}
        fd["__report_meta"] = {
            "status": "ok",
            "is_valid_report": True,
            "error_code": "",
        }
        result["forecast_data"] = fd
        return result
    except Exception as e:
        logger.error(f"generate_daily_summary error: {e} | raw={res['content'][:300]}")
        error_code = _classify_summary_error(e)
        return {
            "summary": FAILED_REPORT_TEXT,
            "intensity_score": 5.0,
            "key_developments": [],
            "hotspots": [],
            "outlook": "",
            "escalation_probability": 0.0,
            "market_correlation": "",
            "forecast_data": {
                "24h": 0.0,
                "48h": 0.0,
                "72h": 0.0,
                "__report_meta": {
                    "status": "error",
                    "is_valid_report": False,
                    "error_code": error_code,
                },
            },
            "thinking_process": str(e)
        }


def _strip_osint_think_leakage(text: str) -> str:
    if not text:
        return ""
    t = re.sub(r"<think>[\s\S]*?</think>", "", text, flags=re.IGNORECASE)
    t = re.sub(r"```(?:json)?\s*[\s\S]*?```", "", t)
    return t.strip()


def _osint_meta_noise(s: str) -> bool:
    if len(s) < 20:
        return True
    bad = (
        "用户要求", "我需要根据", "作为AI", "以下是", "输出JSON", "严格按照",
        "长官提问", "根据提供的数据", "我将", "首先，", "综上所述",
    )
    return any(b in s[:120] for b in bad)


def _osint_best_paragraph(text: str) -> str:
    text = _strip_osint_think_leakage(text)
    paras = [p.strip() for p in re.split(r"\n\n+", text) if p.strip()]
    candidates = [p for p in paras if not _osint_meta_noise(p) and len(p) >= 50]
    if candidates:
        return max(candidates, key=len)
    if paras:
        return max(paras, key=len)
    return text[:1200] if text else ""


def _contains_chinese(text: str) -> bool:
    return bool(re.search(r"[\u4e00-\u9fff]", text or ""))


def _is_placeholder_or_meta(text: str) -> bool:
    if not text:
        return True
    t = text.strip()
    bad_fragments = (
        "<一句话", "<一段", "<中文", "<分析", "core_assessment", "analysis",
        "Input Data", "Determine", "Output Format", "Final Decision",
        "Task:", "Thinking Process", "模板", "占位符",
    )
    if any(b in t for b in bad_fragments):
        return True
    # Placeholder-like short skeletons
    if re.search(r"<[^>]{1,40}>", t):
        return True
    return False


def _clean_osint_text(text: str) -> str:
    if not text:
        return ""
    t = _strip_osint_think_leakage(text)
    # Remove common markdown bullets/enumeration prefixes
    t = re.sub(r"^\s*[-*]\s+", "", t, flags=re.MULTILINE)
    t = re.sub(r"^\s*\d+\.\s+", "", t, flags=re.MULTILINE)
    # Normalize excessive spaces
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r"\n{3,}", "\n\n", t).strip()
    return t


def _parse_osint_json(raw: str) -> Optional[dict]:
    raw = _strip_osint_think_leakage(raw).strip()
    if not raw:
        return None
    try:
        obj = _parse_json_from_response(raw)
        if not isinstance(obj, dict):
            return None
        ca = (obj.get("core_assessment") or obj.get("core") or "").strip()
        an = (obj.get("analysis") or obj.get("深度研判") or "").strip()
        if ca or an:
            return {"core_assessment": ca, "analysis": an}
    except Exception as e:
        logger.debug("OSINT JSON parse failed: %s", e)
    # Fallback: reasoning output may place final JSON near "Output:" marker.
    try:
        obj = _extract_json_segment_near_output(raw)
        if isinstance(obj, dict):
            ca = (obj.get("core_assessment") or obj.get("core") or "").strip()
            an = (obj.get("analysis") or obj.get("深度研判") or "").strip()
            if ca or an:
                return {"core_assessment": ca, "analysis": an}
    except Exception:
        pass
    return None


def _parse_osint_template(text: str) -> Optional[dict]:
    t = _clean_osint_text(text)
    if not t:
        return None
    core = ""
    analysis = ""
    m_core = re.search(
        r"\*{0,2}核心态势\*{0,2}[：:]\s*(.+?)(?=\n\n|\*{0,2}深度研判|$)",
        t,
        re.DOTALL,
    )
    if m_core:
        core = re.sub(r"\s+", " ", m_core.group(1).strip())
    m_an = re.search(
        r"\*{0,2}深度研判\*{0,2}[：:]?\s*([\s\S]+?)(?=\n\*{0,2}[^*]+\*{0,2}[：:]|$)",
        t,
    )
    if m_an:
        analysis = m_an.group(1).strip()
    core = _clean_osint_text(core)
    analysis = _clean_osint_text(analysis)
    if core or analysis:
        return {"core_assessment": core, "analysis": analysis}
    return None


def _build_osint_answer(core: str, analysis: str) -> str:
    parts = []
    if core:
        parts.append(f"**核心态势**：{core}")
    if analysis:
        parts.append(f"**深度研判**：\n{analysis}")
    return "\n\n".join(parts) if parts else ""


async def ask_osint_question(question: str, context: str) -> Dict[str, Any]:
    """
    RAG OSINT：三层解析（JSON / 模板 / 段落兜底），返回结构化结果。
    """
    context = (context or "").strip()
    # RAG 上下文做硬截断，避免在 35B 大模型上因上下文过长导致波动/超时。
    max_ctx_chars = int(os.getenv("OSINT_RAG_MAX_CONTEXT_CHARS", "10000"))
    if max_ctx_chars > 0 and len(context) > max_ctx_chars:
        context = context[:max_ctx_chars]

    sys_json = (
        "你是军情战略指挥中心的 AI 参谋。仅依据下方【战场数据】回答长官提问。\n\n"
        "纪律：禁止内心独白、禁止复述用户指令、禁止罗列新闻条目；必须做情报合成。\n"
        "若有金融数据，analysis 中需简要联动能源/避险情绪。\n\n"
        "【战场数据】\n"
        f"{context}\n\n"
        "输出要求：只输出一个 JSON 对象（不要 markdown），键名固定：\n"
        '{"core_assessment":"<一句话核心态势>","analysis":"<一段连贯深度研判，简体中文>"}\n'
    )
    user_msg = f"长官提问：{question.strip()}"
    messages = [
        {"role": "system", "content": sys_json},
        {"role": "user", "content": user_msg},
    ]
    t0 = time.perf_counter()
    parse_mode = "fallback"
    fallback_reason: Optional[str] = None
    core_assessment = ""
    analysis = ""

    try:
        logger.info("OSINT query start: %s...", question[:40])
        prof = _task_profile("osint_json")
        res = await _chat(
            messages,
            temperature=prof["temperature"],
            num_predict=prof["num_predict"],
            timeout=prof["timeout"],
            format=prof.get("format"),
        )
        raw = (res.get("content") or "").strip() or (res.get("thinking") or "").strip()
        parsed = _parse_osint_json(raw)
        if parsed:
            core_assessment = parsed["core_assessment"]
            analysis = parsed["analysis"]
            parse_mode = "json"
        if not core_assessment and not analysis:
            parsed2 = _parse_osint_template(res.get("content") or "")
            if parsed2:
                core_assessment = parsed2["core_assessment"]
                analysis = parsed2["analysis"]
                parse_mode = "template"
        if not core_assessment and not analysis:
            # Second pass (same model): use lighter non-JSON template to improve
            # practical usability when strict JSON mode drifts into reasoning text.
            retry_sys = (
                "你是军情战略指挥中心 AI 参谋。仅依据给定战场数据回答。\n"
                "不要复述指令，不要输出思考过程。\n"
                "按以下固定模板输出两段：\n"
                "核心态势：一句完整中文判断。\n\n"
                "深度研判：一段完整中文分析。\n"
                "禁止输出任何尖括号占位符、英文提示词或模板说明。\n"
            )
            retry_messages = [
                {"role": "system", "content": retry_sys + "\n\n【战场数据】\n" + context},
                {"role": "user", "content": user_msg},
            ]
            retry_prof = {
                "temperature": min(float(prof["temperature"]), 0.1),
                "num_predict": min(int(prof["num_predict"]), 900),
                "timeout": min(int(prof["timeout"]), 150),
            }
            retry_res = await _chat(
                retry_messages,
                temperature=retry_prof["temperature"],
                num_predict=retry_prof["num_predict"],
                timeout=retry_prof["timeout"],
                format=None,
            )
            retry_content = (retry_res.get("content") or "") + "\n\n" + (retry_res.get("thinking") or "")
            parsed_retry = _parse_osint_template(retry_content)
            if parsed_retry:
                core_assessment = parsed_retry["core_assessment"]
                analysis = parsed_retry["analysis"]
                parse_mode = "template_retry"
                fallback_reason = "strict_json_failed_then_template_retry_ok"
            else:
                combined = _strip_osint_think_leakage(retry_content)
                para = _osint_best_paragraph(combined)
                if para:
                    analysis = para
                    parse_mode = "fallback"
                    fallback_reason = "模型未返回合法 JSON，已采用正文最优段落作为研判摘要"
                else:
                    fallback_reason = "模型返回为空"

        # Final cleanup: remove placeholders/meta leakage from all parse paths.
        core_assessment = _clean_osint_text(core_assessment)
        analysis = _clean_osint_text(analysis)
        if _is_placeholder_or_meta(core_assessment):
            core_assessment = ""
        if _is_placeholder_or_meta(analysis):
            analysis = ""

        # If cleaned result still has no reliable Chinese analysis, fallback to best paragraph.
        if not analysis or not _contains_chinese(analysis):
            combined = _clean_osint_text((res.get("content") or "") + "\n\n" + (res.get("thinking") or ""))
            para = _osint_best_paragraph(combined)
            para = _clean_osint_text(para)
            if para and not _is_placeholder_or_meta(para):
                analysis = para
                parse_mode = "fallback"
                fallback_reason = fallback_reason or "cleaning_replaced_with_best_paragraph"

        if not core_assessment and analysis:
            first = analysis.split("。")[0].strip()
            core_assessment = (first + "。") if first else analysis[:80] + "…"
            if len(core_assessment) > 200:
                core_assessment = analysis[:100] + "…"

        latency_ms = int((time.perf_counter() - t0) * 1000)
        status = "ok" if parse_mode != "fallback" else "degraded"
        if parse_mode == "fallback" and not analysis:
            status = "degraded"
            analysis = "分析引擎未返回可解析内容，请稍后重试或缩短提问范围。"

        answer = _build_osint_answer(core_assessment, analysis)
        if not answer:
            answer = analysis or "暂无法生成研判，请稍后重试。"
            status = "degraded"
            fallback_reason = fallback_reason or "empty_output"

        logger.info(
            "OSINT query done parse_mode=%s status=%s latency_ms=%s reason=%s",
            parse_mode,
            status,
            latency_ms,
            fallback_reason,
        )
        return {
            "status": status,
            "core_assessment": core_assessment,
            "analysis": analysis,
            "answer": answer,
            "fallback_reason": fallback_reason,
            "parse_mode": parse_mode,
            "model": ANALYSIS_MODEL,
            "latency_ms": latency_ms,
        }
    except Exception as e:
        latency_ms = int((time.perf_counter() - t0) * 1000)
        logger.error("ask_osint_question error: %s", e, exc_info=True)
        return {
            "status": "degraded",
            "core_assessment": "",
            "analysis": "",
            "answer": "本地情报推理模块连接异常，无法完成合成研判。请确认 LM Studio 服务可用后重试。",
            "fallback_reason": str(e)[:200],
            "parse_mode": "error",
            "model": ANALYSIS_MODEL,
            "latency_ms": latency_ms,
        }


def _check_lm_studio_models_sync() -> tuple[bool, Optional[str]]:
    try:
        resp = requests.get(f"{LM_STUDIO_BASE}/models", timeout=5)
        if resp.status_code != 200:
            return False, None
        data = resp.json()
        models = data.get("data") or []
        if not models:
            return False, None
        ids = [str(m.get("id", "")) for m in models]
        if LM_STUDIO_MODEL in ids:
            return True, LM_STUDIO_MODEL
        first_id = ids[0] if ids else LM_STUDIO_MODEL
        logger.info("LM Studio: LM_STUDIO_MODEL not in /models, using first available: %s", first_id)
        return True, first_id
    except Exception as e:
        logger.debug("LM Studio /models check failed: %s", e)
        return False, None


def _check_ollama_tags_sync() -> tuple[bool, Optional[str]]:
    try:
        resp = requests.get(f"{OLLAMA_BASE}/api/tags", timeout=5)
        if resp.status_code != 200:
            return False, None
        tags = resp.json()
        names = [str(m.get("name", "")) for m in tags.get("models", [])]
        text_prefix = OLLAMA_TEXT_MODEL.split(":")[0].lower()
        vision_prefix = OLLAMA_VISION_MODEL.split(":")[0].lower()
        has_analysis = any(text_prefix in n.lower() for n in names)
        has_fast = any(text_prefix in n.lower() for n in names)
        has_vision = any(vision_prefix in n.lower() for n in names)
        if not has_analysis:
            logger.warning("Ollama: analysis model %s not found", ANALYSIS_MODEL)
        if not has_vision:
            logger.info("Ollama: optional vision model %s not found yet", OLLAMA_VISION_MODEL)
        if not (has_analysis or has_fast):
            return False, None
        for n in names:
            if text_prefix in n.lower():
                return True, n
        for n in names:
            if text_prefix in n.lower():
                return True, n
        return True, names[0] if names else None
    except Exception:
        return False, None


async def health_check_detail() -> tuple[bool, Optional[str], Optional[str]]:
    """
    Returns (ok, provider, model_id).
    provider is 'lm_studio' or 'ollama' when ok.
    """
    order = _provider_order(ollama_only=False)
    for provider in order:
        if provider == "ollama":
            ok_ol, oid = await asyncio.to_thread(_check_ollama_tags_sync)
            if ok_ol:
                return True, "ollama", oid or OLLAMA_TEXT_MODEL
        else:
            ok_lm, mid = await asyncio.to_thread(_check_lm_studio_models_sync)
            if ok_lm and mid:
                return True, "lm_studio", mid
    return False, None, None


async def health_check() -> bool:
    ok, _, _ = await health_check_detail()
    return ok


# Alias used by processor.py
check_ollama_health = health_check


async def identify_narrative_threads(items: list[dict]) -> list[dict]:
    """
    Cluster a list of news items into coherent narrative 'story arcs'.
    
    Args:
        items: list of {"id": int, "title": str, "summary": str}
        
    Returns:
        list of {"title": str, "summary": str, "category": str, "item_ids": list[int]}
    """
    if not items:
        return []

    context = "\n".join([f"ID:{item['id']} | 标题:{item['title']} | 摘要:{item['summary']}" for item in items])
    
    prompt = (
        "TASK: Cluster discrete news items into 2-4 narrative threads.\n"
        "OUTPUT FORMAT: Strictly JSON array only. No markdown, no thinking, no preamble.\n"
        "SCHEMA: [{\"title\":\"...\", \"summary\":\"...\", \"category\":\"...\", \"item_ids\":[id1, id2]}]\n\n"
        "DATA:\n"
        f"{context}\n\n"
        "RULES:\n"
        "1. title must be a specific theme (no placeholders).\n"
        "2. item_ids must contain valid IDs from the DATA.\n"
        "3. Each thread must have >= 2 items.\n"
        "4. Output ONLY the JSON array."
    )

    messages = [
        {"role": "system", "content": "You are a professional intelligence analyst. Cluster news into narrative threads. Output Stictly JSON array only."},
        {"role": "user", "content": prompt}
    ]

    try:
        prof = _task_profile("threads_json")
        res = await _chat(
            messages,
            temperature=prof["temperature"],
            num_predict=prof["num_predict"],
            timeout=prof["timeout"],
            model=FAST_MODEL, # Qwen2.5 3B is more compliant for strictly formatted tasks
            format=prof.get("format"),
        )
        raw = res["content"] or res["thinking"]
        return _parse_json_from_response(raw)
    except Exception as e:
        logger.error(f"identify_narrative_threads error: {e}")
        return []

async def infer_causal_links(items: list[dict]) -> list[dict]:
    """
    Given a list of news/events, ask LLM to identify causal or response relationships.
    
    Args:
        items: list of {"id": int, "type": str, "title": str, "summary": str}
        
    Returns:
        list of {"source_id": int, "source_type": str, "target_id": int, "target_type": str, "relation": str}
    """
    if len(items) < 2:
        return []

    context = "\n".join([f"({item['type']}_{item['id']}) {item['title']} - {item['summary']}" for item in items])
    
    prompt = (
        "TASK: Identify causal or response relationships between these intelligence items.\n"
        "Look for: A caused B, B is a response to A, A escalated B, etc.\n\n"
        "DATA:\n"
        f"{context}\n\n"
        "OUTPUT FORMAT: Strictly JSON array only.\n"
        "SCHEMA: [{\"source_id\": 1, \"source_type\": \"news\", \"target_id\": 2, \"target_type\": \"event\", \"relation\": \"caused\"}]\n\n"
        "RELATION TYPES: caused, responded_to, escalated, conflicts_with, mitigating\n\n"
        "RULES:\n"
        "1. Only link items where a logical connection is explicitly inferred.\n"
        "2. Ensure source_id and target_id are correct.\n"
        "3. Output ONLY the JSON array."
    )

    messages = [
        {"role": "system", "content": "You are a strategic intelligence analyst. Detect logical causal/response links between events. Output JSON only."},
        {"role": "user", "content": prompt}
    ]

    try:
        prof = _task_profile("causal_links_json")
        res = await _chat(
            messages,
            temperature=prof["temperature"],
            num_predict=prof["num_predict"],
            timeout=prof["timeout"],
            model=FAST_MODEL,
            format=prof.get("format"),
        )
        raw = res["content"] or res["thinking"]
        return _parse_json_from_response(raw)
    except Exception as e:
        logger.error(f"infer_causal_links error: {e}")
        return []
