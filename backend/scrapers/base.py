import asyncio
import httpx
import feedparser
import logging
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Optional
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}


class RawArticle:
    def __init__(
        self,
        source: str,
        source_tier: int,
        title: str,
        url: str,
        content: str = "",
        published_at: Optional[datetime] = None,
        image_url: Optional[str] = None,
    ):
        self.source = source
        self.source_tier = source_tier
        self.title = title
        self.url = url
        self.content = content
        self.published_at = published_at or datetime.now(timezone.utc)
        self.image_url = image_url


class BaseScraper(ABC):
    source_id: str
    source_name: str
    source_tier: int = 2

    async def fetch(self) -> list[RawArticle]:
        try:
            return await self._fetch()
        except Exception as e:
            logger.error(f"[{self.source_id}] fetch error: {e}")
            return []

    @abstractmethod
    async def _fetch(self) -> list[RawArticle]:
        ...


class RssScraper(BaseScraper):
    rss_url: str
    max_items: int = 20

    async def _fetch(self) -> list[RawArticle]:
        async with httpx.AsyncClient(headers=HEADERS, timeout=20, follow_redirects=True) as client:
            resp = await client.get(self.rss_url)
            resp.raise_for_status()

        # feedparser.parse is CPU-bound/sync — run in thread pool to avoid blocking event loop
        feed = await asyncio.to_thread(feedparser.parse, resp.text)
        articles = []
        for entry in feed.entries[: self.max_items]:
            title = entry.get("title", "")
            url = entry.get("link", "")
            if not title or not url:
                continue

            # Extract content
            content = ""
            if hasattr(entry, "content"):
                content = BeautifulSoup(entry.content[0].value, "lxml").get_text(" ", strip=True)
            elif hasattr(entry, "summary"):
                content = BeautifulSoup(entry.summary, "lxml").get_text(" ", strip=True)

            # Parse date
            published_at = None
            if hasattr(entry, "published_parsed") and entry.published_parsed:
                import time
                published_at = datetime.fromtimestamp(
                    time.mktime(entry.published_parsed), tz=timezone.utc
                )

            # Image
            image_url = None
            if hasattr(entry, "media_content") and entry.media_content:
                image_url = entry.media_content[0].get("url")
            elif hasattr(entry, "enclosures") and entry.enclosures:
                image_url = entry.enclosures[0].get("href")

            articles.append(
                RawArticle(
                    source=self.source_name,
                    source_tier=self.source_tier,
                    title=title,
                    url=url,
                    content=content,
                    published_at=published_at,
                    image_url=image_url,
                )
            )
        return articles
