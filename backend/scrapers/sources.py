"""All concrete news source scrapers."""
import httpx
import logging
from datetime import datetime, timezone
from bs4 import BeautifulSoup
from .base import BaseScraper, RssScraper, RawArticle, get_random_headers

logger = logging.getLogger(__name__)

# ── Tier 1: Primary international sources ──────────────────────────────────

class ReutersScraper(RssScraper):
    """Reuters is Cloudflare-protected and blocks server-side RSS fetches.
    Replaced with NYT World RSS which is freely accessible."""
    source_id = "reuters_world"
    source_name = "Reuters / NYT World"
    source_tier = 1
    rss_url = "https://rss.nytimes.com/services/xml/rss/nyt/World.xml"
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
    """AP News no longer offers a free public RSS feed; replaced with
    The Guardian Middle East which has an open RSS endpoint."""
    source_id = "apnews"
    source_name = "The Guardian Middle East"
    source_tier = 1
    rss_url = "https://www.theguardian.com/world/middleeast/rss"
    max_items = 20


class ISWScraper(BaseScraper):
    """Institute for the Study of War — scrapes latest reports."""
    source_id = "isw"
    source_name = "ISW"
    source_tier = 1

    async def _fetch(self) -> list[RawArticle]:
        url = "https://www.understandingwar.org/backgrounder/iran-update"
        async with httpx.AsyncClient(headers=get_random_headers(), timeout=30, follow_redirects=True) as client:
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
    """breakingdefense.com returns 403 for server-side fetches.
    Replaced with RFI English which has a stable open RSS feed."""
    source_id = "breaking_defense"
    source_name = "RFI English"
    source_tier = 2
    rss_url = "https://www.rfi.fr/en/rss"
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


# ── Tier 2 (additional): OSINT / specialty military ────────────────────────

class IranIntlScraper(RssScraper):
    """Iran International — English, breaking Iran news."""
    source_id = "iran_intl"
    source_name = "Iran International"
    source_tier = 1
    rss_url = "https://www.iranintl.com/en/rss"
    max_items = 20


class MiddleEastEyeScraper(RssScraper):
    source_id = "mee"
    source_name = "Middle East Eye"
    source_tier = 1
    rss_url = "https://www.middleeasteye.net/rss"
    max_items = 20


class BNONewsScraper(RssScraper):
    """BNO News — rapid-fire breaking news aggregator."""
    source_id = "bno_news"
    source_name = "BNO News"
    source_tier = 1
    rss_url = "https://bnonews.com/index.php/feed/"
    max_items = 20


class LiveUAMapScraper(RssScraper):
    """LiveUAMap Iran conflict feed is unreachable from this server.
    Replaced with Defense.gov news which has a working RSS endpoint."""
    source_id = "liveuamap_iran"
    source_name = "Defense.gov"
    source_tier = 2
    rss_url = "https://www.defense.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=945&max=10"
    max_items = 15


class CovertShoresScraper(RssScraper):
    """Covert Shores (H.I. Sutton) — naval / submarine OSINT."""
    source_id = "covert_shores"
    source_name = "Covert Shores"
    source_tier = 2
    rss_url = "https://www.hisutton.com/feed"
    max_items = 10


class OSINTDefenderScraper(RssScraper):
    """RSSHub proxy for OSINT Defender returns 403 from this server.
    Replaced with Bellingcat which covers open-source military intelligence."""
    source_id = "osint_defender"
    source_name = "Bellingcat"
    source_tier = 1
    rss_url = "https://www.bellingcat.com/feed/"
    max_items = 20


class NavalNewsScraper(RssScraper):
    """Naval News — warship deployments and naval affairs."""
    source_id = "naval_news"
    source_name = "Naval News"
    source_tier = 2
    rss_url = "https://www.navalnews.com/feed/"
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
    rss_url = "https://www.xinhuanet.com/english/rss/worldrss.xml"
    max_items = 20


# ── Registry ───────────────────────────────────────────────────────────────

ALL_SCRAPERS: list[BaseScraper] = [
    # Tier 1 — primary international + OSINT
    ReutersScraper(),
    BBCScraper(),
    AlJazeeraScraper(),
    APNewsScraper(),
    ISWScraper(),
    IranIntlScraper(),
    MiddleEastEyeScraper(),
    BNONewsScraper(),
    OSINTDefenderScraper(),
    # Tier 2 — military / specialty
    TheWarZoneScraper(),
    BreakingDefenseScraper(),
    DefenseNewsScraper(),
    PoliticoDefenseScraper(),
    LiveUAMapScraper(),
    CovertShoresScraper(),
    NavalNewsScraper(),
    # Tier 3 — Chinese domestic
    GlobalTimesScraper(),
    XinhuaScraper(),
]

SCRAPER_MAP: dict[str, BaseScraper] = {s.source_id: s for s in ALL_SCRAPERS}
