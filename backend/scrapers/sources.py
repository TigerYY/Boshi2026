"""All concrete news source scrapers."""
import httpx
import logging
from datetime import datetime, timezone
from bs4 import BeautifulSoup
from .base import BaseScraper, RssScraper, RawArticle, HEADERS

logger = logging.getLogger(__name__)

# ── Tier 1: Primary international sources ──────────────────────────────────

class ReutersScraper(RssScraper):
    source_id = "reuters_world"
    source_name = "Reuters"
    source_tier = 1
    rss_url = "https://feeds.reuters.com/reuters/worldNews"
    max_items = 30


class BBCScraper(RssScraper):
    source_id = "bbc_world"
    source_name = "BBC World"
    source_tier = 1
    rss_url = "https://feeds.bbci.co.uk/news/world/middle_east/rss.xml"
    max_items = 25


class AlJazeeraScraper(RssScraper):
    source_id = "aljazeera"
    source_name = "Al Jazeera"
    source_tier = 1
    rss_url = "https://www.aljazeera.com/xml/rss/all.xml"
    max_items = 25


class APNewsScraper(RssScraper):
    source_id = "apnews"
    source_name = "AP News"
    source_tier = 1
    rss_url = "https://rsshub.app/apnews/topics/apf-intlnews"
    max_items = 20


class ISWScraper(BaseScraper):
    """Institute for the Study of War — scrapes latest reports."""
    source_id = "isw"
    source_name = "ISW"
    source_tier = 1

    async def _fetch(self) -> list[RawArticle]:
        url = "https://www.understandingwar.org/backgrounder/iran-update"
        async with httpx.AsyncClient(headers=HEADERS, timeout=30, follow_redirects=True) as client:
            resp = await client.get(url)
            resp.raise_for_status()

        soup = BeautifulSoup(resp.text, "lxml")
        articles = []
        for item in soup.select("div.views-row")[:10]:
            a = item.select_one("h3 a, h2 a, .field-title a")
            if not a:
                continue
            title = a.get_text(strip=True)
            href = a.get("href", "")
            if href.startswith("/"):
                href = "https://www.understandingwar.org" + href
            date_el = item.select_one(".date-display-single, time")
            published_at = None
            if date_el:
                try:
                    from dateutil import parser as dp
                    published_at = dp.parse(date_el.get_text(strip=True)).replace(tzinfo=timezone.utc)
                except Exception:
                    pass
            articles.append(
                RawArticle(
                    source=self.source_name,
                    source_tier=self.source_tier,
                    title=title,
                    url=href,
                    published_at=published_at,
                )
            )
        return articles


# ── Tier 2: Secondary military/defense sources ─────────────────────────────

class TheWarZoneScraper(RssScraper):
    source_id = "warzone"
    source_name = "The War Zone"
    source_tier = 2
    rss_url = "https://www.thedrive.com/the-war-zone/feed"
    max_items = 20


class BreakingDefenseScraper(RssScraper):
    source_id = "breaking_defense"
    source_name = "Breaking Defense"
    source_tier = 2
    rss_url = "https://breakingdefense.com/feed/"
    max_items = 15


class DefenseNewsScraper(RssScraper):
    source_id = "defense_news"
    source_name = "Defense News"
    source_tier = 2
    rss_url = "https://www.defensenews.com/arc/outboundfeeds/rss/?outputType=xml"
    max_items = 15


class PoliticoDefenseScraper(RssScraper):
    source_id = "politico"
    source_name = "Politico"
    source_tier = 2
    rss_url = "https://rss.politico.com/defense.xml"
    max_items = 15


# ── Tier 3: Domestic Chinese sources ──────────────────────────────────────

class GlobalTimesScraper(RssScraper):
    source_id = "globaltimes"
    source_name = "Global Times"
    source_tier = 3
    rss_url = "https://www.globaltimes.cn/rss/outbrain.xml"
    max_items = 20


class XinhuaScraper(RssScraper):
    source_id = "xinhua"
    source_name = "Xinhua"
    source_tier = 3
    rss_url = "http://www.xinhuanet.com/english/rss/worldrss.xml"
    max_items = 20


# ── Registry ───────────────────────────────────────────────────────────────

ALL_SCRAPERS: list[BaseScraper] = [
    ReutersScraper(),
    BBCScraper(),
    AlJazeeraScraper(),
    APNewsScraper(),
    ISWScraper(),
    TheWarZoneScraper(),
    BreakingDefenseScraper(),
    DefenseNewsScraper(),
    PoliticoDefenseScraper(),
    GlobalTimesScraper(),
    XinhuaScraper(),
]

SCRAPER_MAP: dict[str, BaseScraper] = {s.source_id: s for s in ALL_SCRAPERS}
