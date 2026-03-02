"""
YouTube latest-video proxy.

Strategy (tried in order):
  1. YouTube native atom feed  (https://www.youtube.com/feeds/videos.xml?channel_id=…)
  2. RSSHub proxy feed          (https://rsshub.app/youtube/channel/…)

The video ID is extracted from the feed so the frontend can build a standard
/embed/{videoId} URL – far more reliable than the deprecated live_stream embed.
Results are cached for 30 minutes.
"""
import re
import time
import logging
import xml.etree.ElementTree as ET

import httpx
from fastapi import APIRouter

router = APIRouter(prefix="/api", tags=["youtube"])
logger = logging.getLogger(__name__)

_cache: dict[str, dict] = {}
_CACHE_TTL = 1800  # 30 minutes

_NS_ATOM = {
    "atom":  "http://www.w3.org/2005/Atom",
    "yt":    "http://www.youtube.com/xml/schemas/2015",
    "media": "http://search.yahoo.com/mrss/",
}

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/atom+xml,application/rss+xml,application/xml;q=0.9,*/*;q=0.8",
}


@router.get("/youtube/latest")
async def get_latest_video(channel_id: str):
    """
    Return the most recent video {videoId, title, published} for a YouTube channel.
    Falls back to RSSHub when YouTube's native feed is unavailable.
    """
    now = time.time()
    cached = _cache.get(channel_id)
    if cached and now - cached["ts"] < _CACHE_TTL:
        return cached["data"]

    sources = [
        f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}",
        f"https://rsshub.app/youtube/channel/{channel_id}",
    ]

    async with httpx.AsyncClient(timeout=12, follow_redirects=True) as client:
        for url in sources:
            try:
                resp = await client.get(url, headers=_HEADERS)
                resp.raise_for_status()
                data = _parse_feed(resp.text)
                if data["videoId"]:
                    _cache[channel_id] = {"ts": now, "data": data}
                    return data
            except Exception as exc:
                logger.debug("Feed fetch failed (%s): %s", url, exc)

    logger.warning("All feed sources failed for channel %s", channel_id)
    return _empty()


# ── RSS / Atom parsers ────────────────────────────────────────────────────────

def _parse_feed(xml_text: str) -> dict:
    """Parse either YouTube Atom or generic RSS and return the first entry."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return _empty()

    # YouTube Atom format (native feed)
    entries = root.findall("atom:entry", _NS_ATOM)
    if entries:
        entry = entries[0]
        vid_el   = entry.find("yt:videoId",     _NS_ATOM)
        title_el = entry.find("atom:title",      _NS_ATOM)
        pub_el   = entry.find("atom:published",  _NS_ATOM)
        if vid_el is not None:
            return {
                "videoId":   vid_el.text,
                "title":     title_el.text if title_el is not None else None,
                "published": pub_el.text   if pub_el   is not None else None,
            }

    # Generic RSS format (RSSHub output)
    ns = {"": ""}  # no namespace
    items = root.findall(".//item")
    if items:
        item = items[0]
        link_el  = item.find("link")
        title_el = item.find("title")
        pub_el   = item.find("pubDate")
        if link_el is not None and link_el.text:
            m = re.search(r"[?&]v=([A-Za-z0-9_-]{11})", link_el.text)
            if m:
                return {
                    "videoId":   m.group(1),
                    "title":     title_el.text if title_el is not None else None,
                    "published": pub_el.text   if pub_el   is not None else None,
                }

    return _empty()


def _empty():
    return {"videoId": None, "title": None, "published": None}
