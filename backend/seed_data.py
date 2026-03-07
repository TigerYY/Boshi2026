"""Seed the database with static demonstration data for US-Iran conflict."""
import asyncio
from datetime import datetime, timezone, timedelta
from models import init_db, AsyncSessionLocal
from models.schemas import MilitaryUnit, ControlZone, MilitaryEvent, NewsItem, ScraperStatus
from scrapers.sources import ALL_SCRAPERS


async def seed():
    await init_db()
    async with AsyncSessionLocal() as db:
        # ── Military Units ─────────────────────────────────────────────────
        units = [
            # US Naval Forces
            MilitaryUnit(name="USS Gerald R. Ford (CVN-78)", unit_type="carrier", side="US",
                         lat=23.5, lon=58.0, location_name="阿拉伯海北部", status="deployed",
                         extra={"air_wing": "CVW-8", "ships": 12}),
            MilitaryUnit(name="USS Dwight D. Eisenhower (CVN-69)", unit_type="carrier", side="US",
                         lat=26.0, lon=56.5, location_name="霍尔木兹海峡西侧", status="deployed",
                         extra={"air_wing": "CVW-3", "ships": 10}),
            MilitaryUnit(name="USS Bataan (LHD-5) Amphibious Ready Group", unit_type="destroyer", side="US",
                         lat=15.5, lon=43.0, location_name="红海中部", status="deployed",
                         extra={"marines": 2200}),
            MilitaryUnit(name="USS Thomas Hudner (DDG-116)", unit_type="destroyer", side="US",
                         lat=13.0, lon=44.5, location_name="曼德海峡", status="engaged",
                         extra={"note": "反导作战巡逻"}),
            # US Air Forces
            MilitaryUnit(name="Al Udeid Air Base (AUAB)", unit_type="airbase", side="US",
                         lat=25.12, lon=51.32, location_name="卡塔尔艾吾代德", status="deployed",
                         extra={"aircraft": 120, "personnel": 10000}),
            MilitaryUnit(name="Al Dhafra Air Base", unit_type="airbase", side="US",
                         lat=24.25, lon=54.55, location_name="阿联酋阿布扎比", status="deployed",
                         extra={"aircraft": 60, "f35s": 24}),
            MilitaryUnit(name="Ali Al Salem Air Base", unit_type="airbase", side="US",
                         lat=29.45, lon=47.52, location_name="科威特", status="deployed",
                         extra={"aircraft": 40}),
            MilitaryUnit(name="B-52H Stratofortress Squadron", unit_type="airbase", side="US",
                         lat=7.37, lon=72.48, location_name="迭戈加西亚基地", status="deployed",
                         extra={"aircraft": 6, "note": "战略轰炸机前置部署"}),
            # US Army
            MilitaryUnit(name="US CENTCOM HQ / Third Army", unit_type="army", side="US",
                         lat=25.12, lon=51.32, location_name="卡塔尔", status="deployed",
                         extra={"personnel": 2500}),
            MilitaryUnit(name="US Forces Iraq (USFI)", unit_type="army", side="US",
                         lat=33.33, lon=44.39, location_name="巴格达", status="deployed",
                         extra={"personnel": 2500}),
            # Iranian Forces
            MilitaryUnit(name="IRGC Navy – Fast Boat Flotilla", unit_type="destroyer", side="Iran",
                         lat=27.15, lon=56.27, location_name="霍尔木兹海峡伊朗侧", status="deployed",
                         extra={"vessels": 50, "note": "快艇骚扰部队"}),
            MilitaryUnit(name="IRGC Aerospace – Shahab-3 Battery", unit_type="missile", side="Iran",
                         lat=34.0, lon=51.5, location_name="德黑兰南部", status="deployed",
                         extra={"range_km": 2000}),
            MilitaryUnit(name="IRGC Aerospace – Emad Missile Site", unit_type="missile", side="Iran",
                         lat=33.5, lon=48.7, location_name="伊朗西部山区", status="deployed",
                         extra={"range_km": 1700}),
            MilitaryUnit(name="IRGC Quds Force – Iraq OPS", unit_type="army", side="Iran",
                         lat=33.3, lon=44.4, location_name="巴格达", status="deployed",
                         extra={"note": "伊拉克民兵协调"}),
            MilitaryUnit(name="IRGC Air Defense – S-300PMU2", unit_type="airbase", side="Iran",
                         lat=32.0, lon=53.7, location_name="伊斯法罕", status="deployed",
                         extra={"batteries": 4}),
            MilitaryUnit(name="Imam Ali Base", unit_type="airbase", side="Iran",
                         lat=32.47, lon=51.67, location_name="伊斯法罕", status="deployed",
                         extra={"aircraft": 60}),
            # Proxy Forces
            MilitaryUnit(name="Houthi (Ansar Allah) – Yemen", unit_type="army", side="proxy",
                         lat=15.35, lon=44.2, location_name="萨那", status="deployed",
                         extra={"note": "红海反舰导弹/无人机攻击源"}),
            MilitaryUnit(name="Kata'ib Hezbollah – Iraq", unit_type="army", side="proxy",
                         lat=33.3, lon=44.4, location_name="巴格达周边", status="deployed",
                         extra={"note": "伊拉克伊朗代理武装"}),
            MilitaryUnit(name="Hezbollah – Lebanon", unit_type="army", side="proxy",
                         lat=33.9, lon=35.5, location_name="黎巴嫩南部", status="deployed",
                         extra={"missiles": 150000}),
        ]
        for u in units:
            db.add(u)

        # ── Control Zones / Exclusion Areas ────────────────────────────────
        zones = [
            ControlZone(
                name="霍尔木兹海峡美军巡逻区",
                zone_type="patrol",
                side="US",
                geojson={
                    "type": "Polygon",
                    "coordinates": [[[55.5, 25.5], [57.5, 25.5], [57.5, 26.8], [55.5, 26.8], [55.5, 25.5]]]
                },
                valid_from=datetime(2025, 1, 1, tzinfo=timezone.utc),
            ),
            ControlZone(
                name="伊朗禁止通行声明区",
                zone_type="exclusion",
                side="Iran",
                geojson={
                    "type": "Polygon",
                    "coordinates": [[[56.0, 25.8], [58.5, 25.8], [58.5, 27.5], [56.0, 27.5], [56.0, 25.8]]]
                },
                valid_from=datetime(2025, 3, 1, tzinfo=timezone.utc),
            ),
            ControlZone(
                name="红海胡塞威胁区",
                zone_type="exclusion",
                side="proxy",
                geojson={
                    "type": "Polygon",
                    "coordinates": [[[38.0, 11.0], [45.0, 11.0], [45.0, 20.0], [38.0, 20.0], [38.0, 11.0]]]
                },
                valid_from=datetime(2025, 1, 1, tzinfo=timezone.utc),
            ),
            ControlZone(
                name="波斯湾商船护航走廊",
                zone_type="patrol",
                side="US",
                geojson={
                    "type": "Polygon",
                    "coordinates": [[[48.0, 23.0], [57.0, 23.0], [57.0, 27.0], [48.0, 27.0], [48.0, 23.0]]]
                },
                valid_from=datetime(2025, 1, 1, tzinfo=timezone.utc),
            ),
        ]
        for z in zones:
            db.add(z)

        # ── Military Events (historical timeline) ──────────────────────────
        now = datetime.now(timezone.utc)
        events = [
            MilitaryEvent(
                event_type="missile",
                title="伊朗向以色列发射弹道导弹袭击",
                description="伊朗革命卫队向以色列发射逾百枚弹道导弹，以色列与美国联合拦截，部分导弹突防。",
                lat=32.0, lon=34.8, location_name="以色列",
                occurred_at=now - timedelta(days=45),
                side="Iran", confirmed=True, severity=5,
            ),
            MilitaryEvent(
                event_type="airstrike",
                title="美军对伊拉克伊朗代理武装基地实施空袭",
                description="美国F-15E战斗机对伊拉克西部伊朗支持的民兵弹药库和指挥所实施精确打击。",
                lat=33.5, lon=42.8, location_name="伊拉克西部安巴尔省",
                occurred_at=now - timedelta(days=38),
                side="US", confirmed=True, severity=4,
            ),
            MilitaryEvent(
                event_type="naval",
                title="美航母打击群通过霍尔木兹海峡",
                description="杰拉尔德·福特号航母打击群在MH-60R直升机护卫下强行通过霍尔木兹海峡，伊朗快艇近距骚扰。",
                lat=26.5, lon=56.3, location_name="霍尔木兹海峡",
                occurred_at=now - timedelta(days=30),
                side="US", confirmed=True, severity=3,
            ),
            MilitaryEvent(
                event_type="missile",
                title="胡塞武装发射反舰弹道导弹击中商船",
                description="胡塞武装发射一枚反舰弹道导弹，击中一艘在红海行驶的利比里亚旗商船，船员紧急撤离。",
                lat=14.5, lon=42.5, location_name="红海中部",
                occurred_at=now - timedelta(days=25),
                side="proxy", confirmed=True, severity=4,
            ),
            MilitaryEvent(
                event_type="airstrike",
                title="以色列空军打击黎巴嫩真主党阵地",
                description="以色列F-35I战机对黎巴嫩南部真主党导弹仓库实施精确打击，目击者报告大规模爆炸。",
                lat=33.5, lon=35.4, location_name="黎巴嫩南部",
                occurred_at=now - timedelta(days=20),
                side="US", confirmed=True, severity=4,
            ),
            MilitaryEvent(
                event_type="land",
                title="美军增兵科威特强化前沿部署",
                description="美国第1骑兵师约3000名士兵部署至科威特，配备M1A2坦克及M2步兵战车，强化波斯湾地面威慑。",
                lat=29.4, lon=47.5, location_name="科威特",
                occurred_at=now - timedelta(days=15),
                side="US", confirmed=True, severity=3,
            ),
            MilitaryEvent(
                event_type="missile",
                title="伊朗试射新型高超音速导弹",
                description="伊朗革命卫队宣布成功试射\"法塔赫-2\"高超音速导弹，声称射程1400公里，可规避防空系统。",
                lat=35.7, lon=51.4, location_name="德黑兰",
                occurred_at=now - timedelta(days=10),
                side="Iran", confirmed=True, severity=4,
            ),
            MilitaryEvent(
                event_type="diplomacy",
                title="美伊通过卡塔尔渠道进行秘密接触",
                description="美国国务院与伊朗外交部据报通过卡塔尔斡旋进行间接接触，讨论临时停火可能性，双方均未官方确认。",
                lat=25.3, lon=51.5, location_name="多哈",
                occurred_at=now - timedelta(days=7),
                side="neutral", confirmed=False, severity=2,
            ),
            MilitaryEvent(
                event_type="airstrike",
                title="美军B-52战略轰炸机实施威慑巡逻",
                description="两架B-52H战略轰炸机携带精确制导炸弹，由F-15和F-22护航，在波斯湾上空执行威慑飞行任务。",
                lat=25.5, lon=54.0, location_name="波斯湾",
                occurred_at=now - timedelta(days=5),
                side="US", confirmed=True, severity=3,
            ),
            MilitaryEvent(
                event_type="naval",
                title="伊朗海军扣押外国油轮",
                description="伊朗伊斯兰革命卫队海军快艇在霍尔木兹海峡扣押一艘巴拿马旗籍油轮，声称违反航运规定。",
                lat=26.2, lon=56.5, location_name="霍尔木兹海峡",
                occurred_at=now - timedelta(days=3),
                side="Iran", confirmed=True, severity=4,
            ),
            MilitaryEvent(
                event_type="airstrike",
                title="美国空袭伊朗在叙利亚军事设施",
                description="美国中央司令部确认，对叙利亚境内伊朗革命卫队相关设施发动精确空袭，摧毁武器储存点和指挥中心。",
                lat=34.8, lon=38.5, location_name="叙利亚中部",
                occurred_at=now - timedelta(days=2),
                side="US", confirmed=True, severity=4,
            ),
            MilitaryEvent(
                event_type="missile",
                title="胡塞武装向红海发射多枚导弹",
                description="胡塞武装向红海商业航道发射3枚反舰导弹，美军驱逐舰成功拦截2枚，1枚落入海中。",
                lat=15.0, lon=42.0, location_name="红海南部",
                occurred_at=now - timedelta(hours=18),
                side="proxy", confirmed=True, severity=3,
            ),
        ]
        # 固定日期事件：2025-02-23～02-28，填补时间轴空档（演示用虚构数据）
        events_feb = [
            MilitaryEvent(
                event_type="airstrike",
                title="美军空袭叙利亚东部伊朗革命卫队据点",
                description="美国中央司令部确认对叙利亚东部代尔祖尔省伊朗革命卫队及代理武装的武器仓库实施精确空袭。",
                lat=35.3, lon=40.1, location_name="叙利亚东部代尔祖尔省",
                occurred_at=datetime(2025, 2, 23, 8, 0, 0, tzinfo=timezone.utc),
                side="US", confirmed=True, severity=4,
            ),
            MilitaryEvent(
                event_type="naval",
                title="红海商船遭无人机袭击，美军拦截多架无人机",
                description="胡塞武装向红海航道发射多架自杀式无人机，美军驱逐舰与联军舰艇实施拦截，一艘商船轻微受损。",
                lat=14.2, lon=42.6, location_name="红海南部",
                occurred_at=datetime(2025, 2, 24, 14, 0, 0, tzinfo=timezone.utc),
                side="proxy", confirmed=True, severity=4,
            ),
            MilitaryEvent(
                event_type="missile",
                title="伊朗向伊拉克库区发射弹道导弹",
                description="伊朗革命卫队宣称对伊拉克库尔德自治区埃尔比勒的\"恐怖分子据点\"发射多枚弹道导弹，伊拉克与美方谴责。",
                lat=36.2, lon=44.0, location_name="伊拉克埃尔比勒",
                occurred_at=datetime(2025, 2, 25, 3, 30, 0, tzinfo=timezone.utc),
                side="Iran", confirmed=True, severity=4,
            ),
            MilitaryEvent(
                event_type="naval",
                title="伊朗快艇在霍尔木兹海峡逼近美军舰艇",
                description="伊朗伊斯兰革命卫队海军多艘快艇在霍尔木兹海峡近距离逼近美军巡逻舰，美军鸣笛示警并保持戒备。",
                lat=26.4, lon=56.2, location_name="霍尔木兹海峡",
                occurred_at=datetime(2025, 2, 26, 10, 0, 0, tzinfo=timezone.utc),
                side="Iran", confirmed=True, severity=3,
            ),
            MilitaryEvent(
                event_type="diplomacy",
                title="美伊通过阿曼就红海停火进行间接磋商",
                description="据报美国与伊朗代表通过阿曼斡旋在马斯喀特进行间接接触，讨论红海与地区局势降温，双方未予官方证实。",
                lat=23.6, lon=58.5, location_name="阿曼马斯喀特",
                occurred_at=datetime(2025, 2, 27, 16, 0, 0, tzinfo=timezone.utc),
                side="neutral", confirmed=False, severity=2,
            ),
            MilitaryEvent(
                event_type="airstrike",
                title="以色列空军打击黎巴嫩真主党火箭阵地",
                description="以色列国防军对黎巴嫩南部真主党火箭发射阵地和武器库实施空袭，回应此前对以北部的火箭弹袭击。",
                lat=33.2, lon=35.3, location_name="黎巴嫩南部",
                occurred_at=datetime(2025, 2, 28, 6, 0, 0, tzinfo=timezone.utc),
                side="US", confirmed=True, severity=4,
            ),
        ]
        for e in events:
            db.add(e)
        for e in events_feb:
            db.add(e)

        # ── Seed Scraper Status ─────────────────────────────────────────────
        for scraper in ALL_SCRAPERS:
            existing = await db.scalar(
                __import__("sqlalchemy", fromlist=["select"]).select(ScraperStatus)
                .where(ScraperStatus.source_id == scraper.source_id)
            )
            if not existing:
                db.add(ScraperStatus(
                    source_id=scraper.source_id,
                    source_name=scraper.source_name,
                    enabled=True,
                    auto_interval_minutes=60,
                ))

        # ── Seed News Items ────────────────────────────────────────────────
        seed_news = [
            NewsItem(
                source="Reuters", source_tier=1,
                title="US deploys additional F-35s to Al Dhafra as Iran tensions mount",
                url="https://reuters.com/demo/us-f35-iran-001",
                content="The United States has deployed an additional squadron of F-35A Lightning II fighters to Al Dhafra Air Base in the UAE...",
                published_at=now - timedelta(hours=3),
                summary_zh="美国向阿联酋阿尔达芙拉基地增派一个中队F-35A战斗机，以应对伊朗核威胁升级和地区紧张局势。",
                category="movement", confidence=0.95, is_breaking=False,
                locations=[{"name": "阿联酋阿尔达芙拉基地", "lat": 24.25, "lon": 54.55}],
                processed=True,
            ),
            NewsItem(
                source="Al Jazeera", source_tier=1,
                title="Iran's IRGC vows retaliation after US airstrike on Syria base",
                url="https://aljazeera.com/demo/iran-retaliation-001",
                content="Iran's Islamic Revolutionary Guard Corps issued a stark warning Saturday, vowing 'crushing retaliation' following US airstrikes...",
                published_at=now - timedelta(hours=6),
                summary_zh="伊朗革命卫队发出强烈警告，誓言对美军空袭叙利亚基地进行报复，称将在\"适当时间和地点\"采取行动。",
                category="diplomacy", confidence=0.90, is_breaking=True,
                locations=[{"name": "德黑兰", "lat": 35.7, "lon": 51.4}],
                processed=True,
            ),
            NewsItem(
                source="ISW", source_tier=1,
                title="Iran Update: IRGC accelerates ballistic missile production",
                url="https://understandingwar.org/demo/iran-update-001",
                content="The Institute for the Study of War assessed that Iran has accelerated production of short and medium-range ballistic missiles...",
                published_at=now - timedelta(hours=12),
                summary_zh="ISW评估报告：伊朗已加速生产短程和中程弹道导弹，革命卫队弹道导弹司令部在多个设施扩大生产线。",
                category="other", confidence=0.92, is_breaking=False,
                locations=[{"name": "伊朗", "lat": 32.0, "lon": 53.0}],
                processed=True,
            ),
            NewsItem(
                source="The War Zone", source_tier=2,
                title="USS Gerald R. Ford Strike Group enters Persian Gulf amid Iran standoff",
                url="https://thedrive.com/demo/ford-persian-gulf-001",
                content="The USS Gerald R. Ford carrier strike group, comprising 12 vessels including guided-missile destroyers...",
                published_at=now - timedelta(hours=20),
                summary_zh="美国杰拉尔德·福特号航母打击群（12艘舰艇）已进入波斯湾，这是美国在该地区30年来最强大的海军集结。",
                category="naval", confidence=0.88, is_breaking=False,
                locations=[{"name": "波斯湾", "lat": 26.0, "lon": 53.0}],
                processed=True,
            ),
            NewsItem(
                source="BBC World", source_tier=1,
                title="Houthis claim responsibility for Red Sea missile attack on tanker",
                url="https://bbc.com/demo/houthi-tanker-001",
                content="Yemen's Houthi movement has claimed responsibility for a missile attack on a commercial tanker in the Red Sea...",
                published_at=now - timedelta(hours=22),
                summary_zh="胡塞武装宣称对红海一艘商业油轮导弹袭击负责，该油轮隶属与以色列有关联的希腊船东，造成轻微损伤。",
                category="missile", confidence=0.91, is_breaking=True,
                locations=[{"name": "红海南部", "lat": 14.5, "lon": 42.5}],
                processed=True,
            ),
            NewsItem(
                source="Global Times", source_tier=3,
                title="China urges restraint as US-Iran tensions escalate in Persian Gulf",
                url="https://globaltimes.cn/demo/china-iran-001",
                content="China's Foreign Ministry urged all parties to exercise maximum restraint Saturday as US-Iran military tensions...",
                published_at=now - timedelta(hours=8),
                summary_zh="中国外交部呼吁各方保持最大克制，防止中东局势进一步升级，重申支持通过外交对话解决分歧。",
                category="diplomacy", confidence=0.75, is_breaking=False,
                locations=[{"name": "波斯湾地区", "lat": 26.0, "lon": 54.0}],
                processed=True,
            ),
        ]
        # 仅插入 URL 不存在的新闻，避免重复运行 seed 时 UNIQUE 冲突
        from sqlalchemy import select
        existing = await db.execute(select(NewsItem.url))
        existing_urls = {r for r, in existing.fetchall()}
        added_news = 0
        for n in seed_news:
            if n.url not in existing_urls:
                db.add(n)
                added_news += 1
        await db.commit()
        print("✅ Seed data loaded successfully." + (f" (本次新增 {added_news} 条新闻)" if added_news else " (新闻已存在，未重复插入)"))


if __name__ == "__main__":
    asyncio.run(seed())
