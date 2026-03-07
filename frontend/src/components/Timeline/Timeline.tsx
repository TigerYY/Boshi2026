import { useState, useEffect, useRef, useCallback } from 'react';
import { format, addHours, differenceInHours, startOfDay, addDays } from 'date-fns';
import type { MilitaryEvent } from '../../api/types';
import type { TimelineState } from '../../store/useAppStore';
import { fetchEvents } from '../../api/client';

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
  const [events, setEvents] = useState<MilitaryEvent[]>([]);
  const [dragging, setDragging] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const playTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentDateRef = useRef(timeline.currentDate);
  useEffect(() => { currentDateRef.current = timeline.currentDate; }, [timeline.currentDate]);

  useEffect(() => {
    fetchEvents({
      since: timeline.startDate.toISOString(),
      until: timeline.endDate.toISOString(),
    }).then(setEvents).catch(console.error);
  }, [timeline.startDate, timeline.endDate]);

  const totalHours = differenceInHours(timeline.endDate, timeline.startDate);
  const currentHours = differenceInHours(timeline.currentDate, timeline.startDate);
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

  if (!timeline.enabled) return null;

  // 热力色带色阶：根据归一化权重返回颜色
  const heatColor = (norm: number, isPast: boolean): string => {
    // 渲染底哨：对有事件的 bucket，强制权重不低于 0.12 以保证基础可见度
    const effectiveNorm = Math.max(0.12, norm);

    if (!isPast) return `rgba(255, 68, 68, ${0.15 + effectiveNorm * 0.25})`;

    // 低烈度区：暗红 → 亮红 (提升基础亮度 80 -> 135)
    if (effectiveNorm < 0.33) {
      const t = effectiveNorm / 0.33;
      return `rgb(${135 + t * 120}, ${Math.round(t * 20)}, ${Math.round(t * 10)})`;
    }
    // 中烈度区：亮红 → 橙
    if (effectiveNorm < 0.66) {
      const t = (effectiveNorm - 0.33) / 0.33;
      return `rgb(255, ${20 + Math.round(t * 87)}, ${10 + Math.round(t * 30)})`;
    }
    // 高烈度区：橙 → 亮黄白
    const t = (effectiveNorm - 0.66) / 0.34;
    return `rgb(255, ${107 + Math.round(t * 138)}, ${40 + Math.round(t * 155)})`;
  };

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

  const BUCKETS = 200;
  const intensityBuckets = new Array(BUCKETS).fill(0).map(() => ({
    weight: 0,
    count: 0,
    events: [] as MilitaryEvent[],
    types: new Set<string>(),
  }));

  events.forEach(e => {
    if (!e.occurred_at) return;
    const pos = differenceInHours(new Date(e.occurred_at), timeline.startDate) / totalHours;
    if (pos < 0 || pos > 1) return;
    const bucketIdx = Math.min(BUCKETS - 1, Math.floor(pos * BUCKETS));
    intensityBuckets[bucketIdx].weight += (e.severity || 1);
    intensityBuckets[bucketIdx].count += 1;
    intensityBuckets[bucketIdx].events.push(e);
    intensityBuckets[bucketIdx].types.add(e.event_type);
  });

  const maxWeight = Math.max(...intensityBuckets.map(b => b.weight), 1);

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
          {/* 整个可拖拽区域 */}
          <div
            ref={trackRef}
            onMouseDown={handleMouseDown}
            style={{ position: 'relative', cursor: 'pointer', userSelect: 'none' }}
          >
            {/* 热力色带 — 30px */}
            <div style={{
              position: 'relative',
              height: 30,
              borderRadius: 2,
              overflow: 'hidden',
              background: 'rgba(0, 212, 255, 0.03)',
            }}>
              {intensityBuckets.map((b, i) => {
                const norm = Math.sqrt(b.weight / maxWeight);
                const isPast = b.count > 0
                  ? b.events.some(e => new Date(e.occurred_at!) <= timeline.currentDate)
                  : (i / BUCKETS) <= progress;
                return (
                  <div
                    key={`hs-${i}`}
                    title={b.count > 0 ? `${b.count}个事件: ${Array.from(b.types).join(', ')}` : undefined}
                    style={{
                      position: 'absolute',
                      top: 0,
                      bottom: 0,
                      left: `${(i / BUCKETS) * 100}%`,
                      width: `0.52%`, // 微量重叠 (100/200=0.5%) 以消除 Sub-pixel 渲染裂缝
                      background: b.count > 0 ? heatColor(norm, isPast) : 'transparent',
                      transition: 'background 0.3s ease',
                    }}
                  />
                );
              })}
            </div>

            {/* 日期轴 — 色带下方 */}
            <div style={{
              position: 'relative',
              height: 14,
              borderTop: `1px solid ${ACCENT}33`,
            }}>
              {/* 逐天刻度 */}
              {(() => {
                const ticks = [];
                let day = startOfDay(addDays(timeline.startDate, 1));
                while (day < timeline.endDate) {
                  const pos = differenceInHours(day, timeline.startDate) / totalHours;
                  if (pos > 0.02 && pos < 0.98) {
                    ticks.push({ date: new Date(day), pos });
                  }
                  day = addDays(day, 1);
                }
                return ticks.map((t, i) => (
                  <div key={`t-${i}`} style={{
                    position: 'absolute',
                    left: `${t.pos * 100}%`,
                    top: 0,
                    transform: 'translateX(-50%)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    pointerEvents: 'none',
                  }}>
                    {/* 刻度线 */}
                    <div style={{
                      width: 1,
                      height: 4,
                      background: `${ACCENT}55`,
                    }} />
                    {/* 日期文字 */}
                    <span style={{
                      fontSize: 8,
                      color: MUTED,
                      lineHeight: 1,
                      marginTop: 1,
                    }}>
                      {format(t.date, 'MM-dd')}
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
