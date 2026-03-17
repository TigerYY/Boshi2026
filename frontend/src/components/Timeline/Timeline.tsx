import { useState, useEffect, useRef, useCallback } from 'react';
import { format, addHours, differenceInHours, startOfDay, addDays } from 'date-fns';
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
  const [dataPoints, setDataPoints] = useState<{ date: Date; weight: number; count: number; types: Set<string> }[]>([]);
  const [dragging, setDragging] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const playTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentDateRef = useRef(timeline.currentDate);
  useEffect(() => { currentDateRef.current = timeline.currentDate; }, [timeline.currentDate]);

  const totalHours = differenceInHours(timeline.endDate, timeline.startDate);
  const currentHours = differenceInHours(timeline.currentDate, timeline.startDate);

  useEffect(() => {
    const params = {
      since: timeline.startDate.toISOString(),
      until: timeline.endDate.toISOString(),
    };

    Promise.all([
      fetchEvents(params),
      // Fetch news with a larger size to ensure coverage for timeline heatmap
      import('../../api/client').then(m => m.fetchNews({ ...params, size: 2000 }))
    ]).then(([eventsArr, newsResp]) => {
      const newsArr = newsResp.items || [];
      const combined = [
        ...eventsArr.filter(e => e.occurred_at).map(e => ({
          date: new Date(e.occurred_at!),
          weight: e.severity || 2,
          type: e.event_type
        })),
        ...newsArr.filter(n => n.published_at).map(n => ({
          date: new Date(n.published_at!),
          weight: 0.8, // News provides baseline "background" density
          type: 'news'
        }))
      ];
      
      const bucketsCount = 400;
      const buckets = new Array(bucketsCount).fill(0).map(() => ({
        weight: 0,
        count: 0,
        types: new Set<string>()
      }));

      combined.forEach(p => {
        const pos = differenceInHours(p.date, timeline.startDate) / totalHours;
        if (pos < 0 || pos > 1) return;
        const idx = Math.min(bucketsCount - 1, Math.floor(pos * bucketsCount));
        buckets[idx].weight += p.weight;
        buckets[idx].count += 1;
        buckets[idx].types.add(p.type);
      });
      
      // Calculate data points for rendering
      setDataPoints(buckets.map((b, i) => ({
        // Map back to a simplified structure for the UI
        date: addHours(timeline.startDate, (i / bucketsCount) * totalHours),
        weight: b.weight,
        count: b.count,
        types: b.types
      })));
    }).catch(console.error);
  }, [timeline.startDate, timeline.endDate, totalHours]);

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
    // 渲染底哨：对有事件的 bucket，强制权重不低于 0.15 以保证基础可见度 (提升 0.12 -> 0.15)
    const effectiveNorm = Math.max(0.18, norm);

    if (!isPast) return `rgba(0, 212, 255, ${0.1 + effectiveNorm * 0.2})`;

    // 低烈度区：深蓝绿 -> 暖橙 (提升基础亮度，强化新闻背景感)
    if (effectiveNorm < 0.3) {
      const t = effectiveNorm / 0.3;
      return `rgb(${Math.round(40 + t * 180)}, ${Math.round(80 + t * 60)}, ${Math.round(200 - t * 140)})`;
    }
    // 中烈度区：暖橙 -> 橙红
    if (effectiveNorm < 0.7) {
      const t = (effectiveNorm - 0.3) / 0.4;
      return `rgb(255, ${140 - Math.round(t * 60)}, ${60 - Math.round(t * 40)})`;
    }
    // 高烈度区：火红 -> 白炽
    const t = (effectiveNorm - 0.7) / 0.3;
    return `rgb(255, ${80 + Math.round(t * 175)}, ${20 + Math.round(t * 235)})`;
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

  const maxWeight = Math.max(...dataPoints.map(b => b.weight), 1);

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
              {dataPoints.map((b, i, arr) => {
                // 使用对数缩放以平滑权重分布，防止极端事件压制背景数据
                const norm = Math.log1p(b.weight) / Math.log1p(maxWeight);
                const isPast = b.date <= timeline.currentDate;
                
                return (
                  <div
                    key={`hs-${i}`}
                    title={b.count > 0 ? `${b.count}条动态: ${Array.from(b.types).join(', ')}` : undefined}
                    style={{
                      position: 'absolute',
                      top: 0,
                      bottom: 0,
                      left: `${(i / arr.length) * 100}%`,
                      width: `0.6%`, // 增加覆盖宽度 (100/200=0.5%) 以形成连续感并消除裂缝
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
