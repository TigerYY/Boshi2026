import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { format, addHours, differenceInHours } from 'date-fns';
import type { TimelineState } from '../../store/useAppStore';
import { fetchTimelineDensity, type TimelineDensityDay, type TimelineDensityMeta } from '../../api/client';

/** UTC 日历日序列 [start..end] 含首尾（按 UTC 日期） */
function buildUtcCalendarDayKeys(start: Date, end: Date): string[] {
  const keys: string[] = [];
  const cur = Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate()
  );
  const endMs = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  let t = cur;
  while (t <= endMs) {
    keys.push(new Date(t).toISOString().slice(0, 10));
    t += 86400000;
  }
  return keys;
}

/** 与后端 effective_since_date / effective_until_date 对齐的 UTC 日键 */
function utcDateKey(d: Date): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

function buildDensityWindowPlain(start: Date, end: Date): string {
  return `${utcDateKey(start)}|${utcDateKey(end)}`;
}

/** 相邻日平滑，避免单日孤立细线 */
function smoothAdjacent(weights: number[], radius: number): number[] {
  if (weights.length === 0) return [];
  return weights.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let k = i - radius; k <= i + radius; k++) {
      if (k >= 0 && k < weights.length) {
        s += weights[k];
        n += 1;
      }
    }
    return n ? s / n : 0;
  });
}

/** 连续烈度色带：低密度深蓝 → 青蓝 → 琥珀 → 橙红 → 高亮 */
function heatColorContinuous(norm: number, isPast: boolean): string {
  const n = Math.max(0, Math.min(1, norm));
  if (!isPast) {
    return `rgba(0, 212, 255, ${0.14 + n * 0.28})`;
  }
  const stops: [number, number, number][] = [
    [22, 48, 78],
    [48, 105, 168],
    [120, 140, 95],
    [230, 115, 38],
    [255, 185, 72],
    [255, 248, 235],
  ];
  const m = stops.length - 1;
  const x = n * m;
  const i = Math.min(Math.floor(x), m - 1);
  const f = x - i;
  const [r0, g0, b0] = stops[i];
  const [r1, g1, b1] = stops[i + 1];
  return `rgb(${Math.round(r0 + f * (r1 - r0))},${Math.round(g0 + f * (g1 - g0))},${Math.round(
    b0 + f * (b1 - b0)
  )})`;
}

/** log 归一化 + 低烈度抬高，避免全挤在色带底部 */
function densityDisplayNorm(weight: number, maxWeight: number, hasDirectRows: boolean): number {
  if (weight <= 0 && !hasDirectRows) return 0;
  const maxW = Math.max(maxWeight, 1e-6);
  const logN = Math.log1p(weight) / Math.log1p(maxW);
  if (!hasDirectRows) {
    return Math.max(0.04, Math.min(1, logN * 0.85 + 0.08));
  }
  return Math.max(0.1, Math.min(1, 0.12 + logN * 0.88));
}

type DayHeatColumn = {
  dateKey: string;
  centerDate: Date;
  weight: number;
  count: number;
  types: Set<string>;
  newsFetchedFallback: number;
};

const ACCENT = '#00d4ff';
const ACCENT_BG = 'rgba(0, 212, 255, 0.13)';
const BORDER = '#1e2d40';
const MUTED = '#556677';
const PLAY_ACTIVE = '#ff6b35';
const PLAY_ACTIVE_BG = 'rgba(255, 107, 53, 0.13)';

interface Props {
  timeline: TimelineState;
  onChange: (state: Partial<TimelineState>) => void;
}

export default function Timeline({ timeline, onChange }: Props) {
  const [dayHeatColumns, setDayHeatColumns] = useState<DayHeatColumn[]>([]);
  const [densityDayRows, setDensityDayRows] = useState<TimelineDensityDay[]>([]);
  const [densityMeta, setDensityMeta] = useState<TimelineDensityMeta | null>(null);
  const [densityError, setDensityError] = useState<string | null>(null);
  /** 响应与 meta 汇总不一致等（不静默展示错窗数据时已丢弃，此项为可应用数据上的校验） */
  const [densityAnomaly, setDensityAnomaly] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const playTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const densityReqSeqRef = useRef(0);
  const currentDateRef = useRef(timeline.currentDate);
  useEffect(() => { currentDateRef.current = timeline.currentDate; }, [timeline.currentDate]);

  const totalHours = differenceInHours(timeline.endDate, timeline.startDate);
  const currentHours = differenceInHours(timeline.currentDate, timeline.startDate);

  useEffect(() => {
    const expectedPlain = buildDensityWindowPlain(timeline.startDate, timeline.endDate);
    const params = {
      since: timeline.startDate.toISOString(),
      until: timeline.endDate.toISOString(),
    };
    const seq = ++densityReqSeqRef.current;
    const controller = new AbortController();

    setDensityError(null);
    setDensityAnomaly(null);

    fetchTimelineDensity(params, controller.signal)
      .then(({ days, meta }) => {
        if (seq !== densityReqSeqRef.current) return;
        if (meta?.window_signature_plain && meta.window_signature_plain !== expectedPlain) return;

        const sumNews = (days ?? []).reduce((s, d) => s + d.news_count, 0);
        const sumEv = (days ?? []).reduce((s, d) => s + d.event_count, 0);
        let anomaly: string | null = null;
        if (meta) {
          if (meta.sums_consistent === false) {
            anomaly = '日汇总与库总量不一致（口径异常）';
          } else if (meta.sum_news_count_days != null && sumNews !== meta.sum_news_count_days) {
            anomaly = '新闻日计数与接口 meta 不一致';
          } else if (meta.sum_event_count_days != null && sumEv !== meta.sum_event_count_days) {
            anomaly = '事件日计数与接口 meta 不一致';
          } else if (meta.total_news_rows != null && sumNews !== meta.total_news_rows) {
            anomaly = '新闻条数与日合计不一致';
          } else if (meta.total_event_rows != null && sumEv !== meta.total_event_rows) {
            anomaly = '事件条数与日合计不一致';
          }
        }
        setDensityAnomaly(anomaly);
        setDensityMeta(meta ?? null);
        setDensityDayRows(days ?? []);

        const dayKeys = buildUtcCalendarDayKeys(timeline.startDate, timeline.endDate);
        const rowByDate = new Map((days ?? []).map((d) => [d.date, d]));
        const rawWeights: number[] = [];
        const cols: DayHeatColumn[] = dayKeys.map((key) => {
          const r = rowByDate.get(key);
          const news = r?.news_count ?? 0;
          const ev = r?.event_count ?? 0;
          const sev = r?.event_severity_sum ?? 0;
          const fbf = r?.news_fetched_fallback ?? 0;
          const w = sev + news * 0.8;
          rawWeights.push(w);
          const types = new Set<string>();
          if (news > 0) types.add('news');
          if (ev > 0) types.add('event');
          return {
            dateKey: key,
            centerDate: new Date(`${key}T12:00:00.000Z`),
            weight: w,
            count: news + ev,
            types,
            newsFetchedFallback: fbf,
          };
        });
        const smoothedW = smoothAdjacent(rawWeights, 1);
        setDayHeatColumns(cols.map((c, i) => ({ ...c, weight: smoothedW[i] })));
      })
      .catch((err: { code?: string; name?: string }) => {
        if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') return;
        if (seq !== densityReqSeqRef.current) return;
        console.error(err);
        setDensityError('时间轴数据加载失败，请检查网络或后端服务');
        setDensityMeta(null);
        setDensityDayRows([]);
        setDayHeatColumns([]);
        setDensityAnomaly(null);
      });

    return () => controller.abort();
  }, [timeline.startDate, timeline.endDate]);

  const progress = totalHours > 0 ? Math.max(0, Math.min(1, currentHours / totalHours)) : 0;

  const seekTo = useCallback((clientX: number) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const newDate = addHours(timeline.startDate, p * totalHours);
    onChange({ currentDate: newDate });
  }, [timeline.startDate, totalHours, onChange]);

  useEffect(() => {
    if (!timeline.playing) {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
      return;
    }
    playTimerRef.current = setInterval(() => {
      const next = addHours(currentDateRef.current, 6 * timeline.speedMultiplier);
      if (next >= timeline.endDate) {
        clearInterval(playTimerRef.current!);
        onChange({ currentDate: timeline.endDate, playing: false });
      } else {
        onChange({ currentDate: next });
      }
    }, 500);
    return () => { if (playTimerRef.current) clearInterval(playTimerRef.current); };
  }, [timeline.playing, timeline.speedMultiplier, timeline.endDate, onChange]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setDragging(true);
    seekTo(e.clientX);
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (dragging) seekTo(e.clientX);
  }, [dragging, seekTo]);

  const handleMouseUp = useCallback(() => setDragging(false), []);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  const utcDayKeys = useMemo(
    () => buildUtcCalendarDayKeys(timeline.startDate, timeline.endDate),
    [timeline.startDate, timeline.endDate]
  );
  const totalDays = Math.max(1, utcDayKeys.length);
  const daysWithDataSet = new Set(
    densityDayRows.filter((d) => d.news_count + d.event_count > 0).map((d) => d.date)
  );
  const daysWithData = utcDayKeys.filter((k) => daysWithDataSet.has(k)).length;
  let maxConsecutiveEmpty = 0;
  let run = 0;
  for (const key of utcDayKeys) {
    if (daysWithDataSet.has(key)) {
      run = 0;
    } else {
      run += 1;
      maxConsecutiveEmpty = Math.max(maxConsecutiveEmpty, run);
    }
  }
  const showSparseHint = maxConsecutiveEmpty >= 5;
  const noRowsInWindow =
    !!densityMeta &&
    (densityMeta.total_news_rows ?? 0) === 0 &&
    (densityMeta.total_event_rows ?? 0) === 0 &&
    utcDayKeys.length > 0;

  if (!timeline.enabled) return null;

  const controlBar = (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '4px 12px',
      borderBottom: collapsed ? 'none' : `1px solid ${BORDER}`,
      background: 'rgba(8, 12, 18, 0.6)',
    }}>
      {/* Left: title + current time */}
      <span style={{
        fontSize: 9,
        color: ACCENT,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
      }}>
        ⏱
      </span>
      <span style={{
        fontSize: 11,
        color: '#c9d1d9',
        fontWeight: 600,
        textShadow: `0 0 8px ${ACCENT}4D`,
      }}>
        {format(timeline.currentDate, 'yyyy-MM-dd HH:mm')}
      </span>
      <div style={{ flex: 1 }} />

      {/* Right: speed | play | start/current */}
      {!collapsed && (
        <>
          {[0.5, 1, 2, 4].map(s => (
            <button
              key={s}
              onClick={() => onChange({ speedMultiplier: s })}
              style={{
                padding: '1px 6px',
                fontSize: 9,
                borderRadius: 2,
                cursor: 'pointer',
                background: timeline.speedMultiplier === s ? ACCENT_BG : 'transparent',
                border: `1px solid ${timeline.speedMultiplier === s ? ACCENT : BORDER}`,
                color: timeline.speedMultiplier === s ? ACCENT : MUTED,
              }}
            >
              {s}x
            </button>
          ))}
        </>
      )}

      <button
        onClick={() => {
          if (timeline.playing) {
            onChange({ playing: false });
          } else {
            const atEnd = timeline.currentDate >= timeline.endDate;
            onChange({
              playing: true,
              enabled: true,
              ...(atEnd ? { currentDate: timeline.startDate } : {}),
            });
          }
        }}
        style={{
          padding: '2px 10px',
          fontSize: 10,
          borderRadius: 2,
          cursor: 'pointer',
          background: timeline.playing ? PLAY_ACTIVE_BG : ACCENT_BG,
          border: `1px solid ${timeline.playing ? PLAY_ACTIVE : ACCENT}`,
          color: timeline.playing ? PLAY_ACTIVE : ACCENT,
        }}
      >
        {timeline.playing ? '⏸' : '▶'}
      </button>

      {!collapsed && (
        <>
          <button
            onClick={() => onChange({ currentDate: timeline.startDate, playing: false })}
            title="回到时间轴起点"
            style={{
              padding: '1px 6px',
              fontSize: 9,
              borderRadius: 2,
              cursor: 'pointer',
              background: 'transparent',
              border: `1px solid ${BORDER}`,
              color: MUTED,
            }}
          >
            ⏮
          </button>
          <button
            onClick={() => onChange({ currentDate: new Date(), playing: false })}
            title="跳到最新"
            style={{
              padding: '1px 6px',
              fontSize: 9,
              borderRadius: 2,
              cursor: 'pointer',
              background: 'transparent',
              border: `1px solid ${BORDER}`,
              color: MUTED,
            }}
          >
            ⏭
          </button>
        </>
      )}

      <button
        onClick={() => setCollapsed(c => !c)}
        title={collapsed ? '展开时间轴' : '收起时间轴'}
        style={{
          padding: '1px 5px',
          fontSize: 9,
          borderRadius: 2,
          cursor: 'pointer',
          background: 'transparent',
          border: `1px solid ${BORDER}`,
          color: MUTED,
        }}
      >
        {collapsed ? '▾' : '▴'}
      </button>
    </div>
  );

  const maxWeight = Math.max(...dayHeatColumns.map((b) => b.weight), 1e-6);

  return (
    <div
      className="hud-panel corner-brackets"
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        borderTop: `1px solid ${BORDER}`,
        borderRadius: 0,
        background: 'rgba(13, 17, 23, 0.94)',
        backdropFilter: 'blur(8px)',
      }}
    >
      {controlBar}

      {!collapsed && (
        <div style={{ padding: '4px 12px 4px' }}>
          {/* 数据覆盖提示 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 10, color: MUTED, flexWrap: 'wrap' }}>
            <span>
              有数据 {daysWithData} / 总 {totalDays} 天（UTC 日历日）
              {densityMeta?.matched_day_count != null && densityMeta.matched_day_count !== daysWithData ? (
                <span style={{ color: '#556677', marginLeft: 4 }}>· API {densityMeta.matched_day_count} 日有记录</span>
              ) : null}
            {densityMeta && (densityMeta.total_news_fetched_fallback ?? 0) > 0 ? (
              <span style={{ color: '#556677', marginLeft: 4 }}>
                · {densityMeta.total_news_fetched_fallback} 条新闻按采集日计入
              </span>
            ) : null}
            </span>
            {densityMeta?.timezone_basis === 'UTC' ? (
              <span style={{ color: '#445566', marginLeft: 4 }}>· 分日 UTC</span>
            ) : null}
            {densityError && (
              <span style={{ color: '#ff6b6b' }}>{densityError}</span>
            )}
            {densityAnomaly && !densityError && (
              <span style={{ color: '#ff9f43' }}>· {densityAnomaly}</span>
            )}
            {!densityError && !densityAnomaly && noRowsInWindow && (
              <span style={{ color: '#8b9ab0' }}>当前 UTC 窗口内无新闻/事件聚合记录</span>
            )}
            {!densityError &&
              !densityAnomaly &&
              !noRowsInWindow &&
              daysWithData > 0 &&
              daysWithData < totalDays * 0.6 && (
              <span style={{ color: 'rgba(140, 170, 200, 0.95)' }}>· 部分日期为低密度渐变（非缺失）</span>
            )}
            {showSparseHint && !densityError && !densityAnomaly && (
              <span style={{ color: 'rgba(255, 180, 80, 0.9)' }}>连续多日无记录</span>
            )}
          </div>
          {/* 整个可拖拽区域 */}
          <div
            ref={trackRef}
            onMouseDown={handleMouseDown}
            style={{ position: 'relative', cursor: 'pointer', userSelect: 'none' }}
          >
            {/* 按 UTC 日历日一列铺满（与数据粒度一致） */}
            <div
              style={{
                display: 'flex',
                height: 30,
                borderRadius: 2,
                overflow: 'hidden',
                background: 'rgba(0, 212, 255, 0.03)',
                gap: 0,
              }}
            >
              {dayHeatColumns.map((b, i) => {
                const isPast = b.centerDate <= timeline.currentDate;
                const isEmpty = b.count === 0 && b.weight <= 1e-8;
                const displayNorm = isEmpty
                  ? 0
                  : densityDisplayNorm(b.weight, maxWeight, b.count > 0);
                const tip =
                  b.count > 0
                    ? `${b.dateKey} · ${b.count}条 (${Array.from(b.types).join('/')})` +
                      (b.newsFetchedFallback > 0 ? ` · ${b.newsFetchedFallback}条仅采集日` : '')
                    : b.weight > 1e-8
                      ? `${b.dateKey} · 邻近日扩散低密度`
                      : `${b.dateKey} · 无数据`;
                return (
                  <div
                    key={`dc-${b.dateKey}-${i}`}
                    title={tip}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      boxSizing: 'border-box',
                      borderRight:
                        i < dayHeatColumns.length - 1 ? '1px solid rgba(0,0,0,0.25)' : undefined,
                      background: isEmpty
                        ? 'rgba(0, 212, 255, 0.045)'
                        : heatColorContinuous(displayNorm, isPast),
                      transition: 'background 0.35s ease',
                    }}
                  />
                );
              })}
            </div>

            <div
              style={{
                position: 'relative',
                height: 14,
                borderTop: `1px solid ${ACCENT}33`,
              }}
            >
              {(() => {
                const n = dayHeatColumns.length;
                if (n === 0) return null;
                const maxTicks = 14;
                const step = Math.max(1, Math.ceil(n / maxTicks));
                const ticks: { label: string; pos: number }[] = [];
                for (let i = 0; i < n; i += step) {
                  const key = dayHeatColumns[i].dateKey;
                  const [, m, d] = key.split('-');
                  ticks.push({ label: `${m}-${d}`, pos: (i + 0.5) / n });
                }
                if (n > 1 && (n - 1) % step !== 0) {
                  const last = dayHeatColumns[n - 1].dateKey;
                  const [, m, d] = last.split('-');
                  ticks.push({ label: `${m}-${d}`, pos: (n - 0.5) / n });
                }
                return ticks.map((t, i) => (
                  <div
                    key={`t-${i}-${t.label}`}
                    style={{
                      position: 'absolute',
                      left: `${t.pos * 100}%`,
                      top: 0,
                      transform: 'translateX(-50%)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      pointerEvents: 'none',
                    }}
                  >
                    <div
                      style={{
                        width: 1,
                        height: 4,
                        background: `${ACCENT}55`,
                      }}
                    />
                    <span
                      style={{
                        fontSize: 8,
                        color: MUTED,
                        lineHeight: 1,
                        marginTop: 1,
                      }}
                    >
                      {t.label}
                    </span>
                  </div>
                ));
              })()}
            </div>

            {/* 播放游标 — 贯穿色带+日期轴 */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${progress * 100}%`,
                width: 2,
                background: ACCENT,
                transform: 'translateX(-50%)',
                boxShadow: `0 0 6px ${ACCENT}, 0 0 12px ${ACCENT}55`,
                zIndex: 3,
                pointerEvents: 'none',
              }}
            >
              {/* 顶部三角指示器 */}
              <div style={{
                position: 'absolute',
                top: -4,
                left: '50%',
                transform: 'translateX(-50%)',
                width: 0,
                height: 0,
                borderLeft: '4px solid transparent',
                borderRight: '4px solid transparent',
                borderTop: `4px solid ${ACCENT}`,
              }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
