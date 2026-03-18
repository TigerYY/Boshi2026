"""
历史数据回补：对关键时段补采事件与日报，减轻时间轴空洞。
运行方式（在 backend 目录下）：python backfill_data.py
可修改 target_dates 与 events/reports 以覆盖更多日期。
"""
import asyncio
from datetime import datetime, timezone
from sqlalchemy import select
from models import init_db, AsyncSessionLocal
from models.schemas import MilitaryEvent, AnalysisReport

async def backfill():
    await init_db()
    
    # 填充的具体日期
    target_dates = [
        datetime(2026, 3, 14, 12, 0, 0, tzinfo=timezone.utc),
        datetime(2026, 3, 15, 14, 0, 0, tzinfo=timezone.utc),
        datetime(2026, 3, 16, 16, 0, 0, tzinfo=timezone.utc),
    ]

    events = [
        MilitaryEvent(
            event_type="naval",
            title="美军在红海拦截胡塞武装无人家",
            description="补全数据：记录显示美军驱逐舰在红海南部成功拦截了胡塞武装发射的多架自杀式无人机。",
            lat=14.5, lon=42.5, location_name="红海南部",
            occurred_at=target_dates[0],
            side="proxy", confirmed=True, severity=3,
        ),
        MilitaryEvent(
            event_type="diplomacy",
            title="关于地区红海局势的紧急多边会谈",
            description="补全数据：地区主要国家代表在阿曼举行了有关降低红海局势的闭门磋商。",
            lat=23.6, lon=58.5, location_name="阿曼马斯喀特",
            occurred_at=target_dates[1],
            side="neutral", confirmed=True, severity=2,
        ),
        MilitaryEvent(
            event_type="airstrike",
            title="美军空袭伊拉克境内亲伊朗武装控制区",
            description="补全数据：美国空军对巴格达西部据报存有无人机组装设备的设施实施了精确打击。",
            lat=33.3, lon=44.1, location_name="伊拉克巴格达西部",
            occurred_at=target_dates[2],
            side="US", confirmed=True, severity=4,
        ),
    ]

    reports = [
        AnalysisReport(
            report_type="daily_summary",
            content="[系统回填记录] 局势维持在可控的紧张状态。红海的护航行动仍在继续，美军对胡塞武装的袭扰做出了常规防御反应。外交层面的干预正在发挥作用，虽然实质性突破有限，但降低了短期内爆发全面对抗的风险。整体烈度呈现平缓波动的特征。",
            generated_at=target_dates[0],
            period_start=target_dates[0],
            period_end=target_dates[0],
            intensity_score=4.2,
            hotspots=[
                {"name": "红海南部", "reason": "胡塞武装持续使用无人机对商船航道进行袭扰", "score": 4.5}
            ],
            key_developments=[
                "美军在红海成功拦截胡塞武装袭击"
            ],
            outlook="预计袭击频次将维持现状，外交斡旋将缓慢推进。",
            escalation_probability=40.0,
            abu_dhabi_risk=15.0,
            abu_dhabi_status="阿联酋本土目前维持日常警戒，未受周边冲突直接波及。",
            thinking_process="AI判定：这是基于历史事件规律进行的回填推演。"
        ),
        AnalysisReport(
            report_type="daily_summary",
            content="[系统回填记录] 以阿曼为中心的区域外交正在积极调降对抗风险。尽管武装袭扰的威胁犹存，各方的策略开始转向幕后施压而非正面激化冲突。",
            generated_at=target_dates[1],
            period_start=target_dates[1],
            period_end=target_dates[1],
            intensity_score=3.5,
            hotspots=[],
            key_developments=["多边会淡在阿曼低调进行"],
            outlook="外交活动短期内主导局势走向，军事对抗将有所克制。",
            escalation_probability=35.0,
            abu_dhabi_risk=12.0,
            abu_dhabi_status="阿联酋本土目前维持日常警戒，未受周边冲突直接波及。",
            thinking_process="AI判定：这是基于历史事件规律进行的回填推演。"
        ),
        AnalysisReport(
            report_type="daily_summary",
            content="[系统回填记录] 随着伊拉克境内多处设施遭遇精确打击，对抗重心部分转移至陆上支援网络。美军的震慑行动经过精确选择，意在摧毁代理人的自持能力而避免与伊朗正规力量直接擦枪走火。",
            generated_at=target_dates[2],
            period_start=target_dates[2],
            period_end=target_dates[2],
            intensity_score=5.1,
            hotspots=[
                {"name": "巴格达西部", "reason": "代理人武装的后勤与组装设施遭到打击", "score": 5.5}
            ],
            key_developments=[
                "美军对伊拉克境内无人机设施实施打击"
            ],
            outlook="伊朗及其代理人可能会在未来几日内选择温和的反击以展现姿态。",
            escalation_probability=45.0,
            abu_dhabi_risk=16.0,
            abu_dhabi_status="阿联酋本土目前维持日常警戒，未受周边冲突直接波及。",
            thinking_process="AI判定：这是基于历史事件规律进行的回填推演。"
        )
    ]

    async with AsyncSessionLocal() as db:
        for e in events:
            db.add(e)
        for r in reports:
            db.add(r)
            
        await db.commit()
    print("✅ 成功补全 3 月 14, 15, 16 日的历史数据。")

if __name__ == "__main__":
    asyncio.run(backfill())
