import { useState, useEffect, useRef, useCallback } from 'react';
import { format, addHours, differenceInHours } from 'date-fns';
import type { MilitaryEvent } from '../../api/types';
import type { TimelineState } from '../../store/useAppStore';
import { fetchEvents } from '../../api/client';

const ACCENT = '#00d4ff';
const ACCENT_BG = 'rgba(0, 212, 255, 0.13)';
const DANGER = '#ff4444';
const DANGER_FUTURE = 'rgba(255, 68, 68, 0.33)';
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

  const controlBar = (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '6px 12px',
      borderBottom: collapsed ? 'none' : `1px solid ${BORDER}`,
      background: 'rgba(8, 12, 18, 0.6)',
    }}>
      {/* Left: title + current time */}
      <span style={{
        fontSize: 10,
        color: ACCENT,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
      }}>
        ⏱ 时间轴
      </span>
      <span style={{
        fontSize: 12,
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
          <span style={{ fontSize: 10, color: MUTED }}>速度</span>
          {[0.5, 1, 2, 4].map(s => (
            <button
              key={s}
              onClick={() => onChange({ speedMultiplier: s })}
              style={{
                padding: '2px 8px',
                fontSize: 10,
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
          <span style={{ width: 1, height: 14, background: BORDER }} />
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
          padding: '3px 12px',
          fontSize: 11,
          borderRadius: 2,
          cursor: 'pointer',
          background: timeline.playing ? PLAY_ACTIVE_BG : ACCENT_BG,
          border: `1px solid ${timeline.playing ? PLAY_ACTIVE : ACCENT}`,
          color: timeline.playing ? PLAY_ACTIVE : ACCENT,
        }}
      >
        {timeline.playing ? '⏸ 暂停' : '▶ 播放'}
      </button>

      {!collapsed && (
        <>
          <span style={{ width: 1, height: 14, background: BORDER }} />
          <button
            onClick={() => onChange({ currentDate: timeline.startDate, playing: false })}
            title="回到时间轴起点"
            style={{
              padding: '2px 8px',
              fontSize: 10,
              borderRadius: 2,
              cursor: 'pointer',
              background: 'transparent',
              border: `1px solid ${BORDER}`,
              color: MUTED,
            }}
          >
            ⏮ 起点
          </button>
          <button
            onClick={() => onChange({ currentDate: new Date(), playing: false })}
            title="跳到最新"
            style={{
              padding: '2px 8px',
              fontSize: 10,
              borderRadius: 2,
              cursor: 'pointer',
              background: 'transparent',
              border: `1px solid ${BORDER}`,
              color: MUTED,
            }}
          >
            ⏭ 当前
          </button>
        </>
      )}

      <button
        onClick={() => setCollapsed(c => !c)}
        title={collapsed ? '展开时间轴' : '收起时间轴'}
        style={{
          padding: '2px 6px',
          fontSize: 10,
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

  const BUCKETS = 100;
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
        <div style={{ padding: '8px 12px 6px' }}>
          <div
            ref={trackRef}
            className="timeline-track"
            onMouseDown={handleMouseDown}
          >
            {intensityBuckets.map((b, i) => {
              if (b.count === 0) return null;
              const height = (b.weight / maxWeight) * 100;
              const isPast = b.events.some(e => new Date(e.occurred_at!) <= timeline.currentDate);
              return (
                <div
                  key={`bucket-${i}`}
                  title={`${b.count}个事件: ${Array.from(b.types).join(', ')}`}
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: `${(i / BUCKETS) * 100}%`,
                    width: `${100 / BUCKETS - 0.2}%`,
                    height: `${height}%`,
                    marginLeft: '0.1%',
                    background: isPast ? DANGER : DANGER_FUTURE,
                    borderRadius: '1px 1px 0 0',
                    borderTop: `1px solid ${isPast ? '#ff0000' : 'rgba(255,0,0,0.25)'}`,
                    zIndex: 1,
                    transition: 'height 0.3s ease',
                  }}
                />
              );
            })}

            {/* 横轴线：与波形底边一致 */}
            <div style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: 1,
              background: 'rgba(0, 212, 255, 0.35)',
              zIndex: 1,
            }} />
            {/* 横轴上仅突出点（无竖线） */}
            {[0, 0.25, 0.5, 0.75, 1].map((p, i) => (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: `${p * 100}%`,
                  bottom: 0,
                  transform: 'translate(-50%, 50%)',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: ACCENT,
                  boxShadow: `0 0 8px ${ACCENT}`,
                  border: `1px solid rgba(0, 212, 255, 0.7)`,
                  zIndex: 2,
                }}
              />
            ))}

            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${progress * 100}%`,
                width: 2,
                background: ACCENT,
                transform: 'translateX(-50%)',
                boxShadow: `0 0 6px ${ACCENT}`,
                zIndex: 3,
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  bottom: -5,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 10,
                  height: 10,
                  background: ACCENT,
                  borderRadius: '50%',
                  border: `1px solid rgba(0, 212, 255, 0.6)`,
                }}
              />
            </div>
          </div>

          {/* 日期标签（无竖线） */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 9,
            color: MUTED,
            marginTop: 6,
          }}>
            <span>{format(timeline.startDate, 'MM-dd')}</span>
            <span>{format(addHours(timeline.startDate, totalHours * 0.25), 'MM-dd')}</span>
            <span>{format(addHours(timeline.startDate, totalHours * 0.5), 'MM-dd')}</span>
            <span>{format(addHours(timeline.startDate, totalHours * 0.75), 'MM-dd')}</span>
            <span>{format(timeline.endDate, 'MM-dd')}</span>
          </div>
        </div>
      )}
    </div>
  );
}
