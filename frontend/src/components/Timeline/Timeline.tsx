import { useState, useEffect, useRef, useCallback } from 'react';
import { format, addHours, differenceInHours } from 'date-fns';
import type { MilitaryEvent } from '../../api/types';
import type { TimelineState } from '../../store/useAppStore';
import { fetchEvents } from '../../api/client';

interface Props {
  timeline: TimelineState;
  onChange: (state: Partial<TimelineState>) => void;
}

const EVENT_COLORS: Record<string, string> = {
  airstrike: '#ff6b35', missile: '#ff2244', naval: '#00d4ff',
  land: '#00ff88', diplomacy: '#9c66ff', sanction: '#ffdd00', other: '#888',
};

export default function Timeline({ timeline, onChange }: Props) {
  const [events, setEvents] = useState<MilitaryEvent[]>([]);
  const [dragging, setDragging] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const playTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Playback
  useEffect(() => {
    if (!timeline.playing) {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
      return;
    }
    playTimerRef.current = setInterval(() => {
      onChange(prev => {
        const next = addHours((prev as TimelineState).currentDate, 6 * timeline.speedMultiplier);
        if (next >= timeline.endDate) {
          clearInterval(playTimerRef.current!);
          return { currentDate: timeline.endDate, playing: false } as Partial<TimelineState>;
        }
        return { currentDate: next } as Partial<TimelineState>;
      });
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

  return (
    <div className="mil-panel" style={{
      position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 1000,
      borderTop: '1px solid #1e2d40', borderRadius: 0,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 12px', borderBottom: '1px solid #1e2d4044' }}>
        <span style={{ fontSize: 10, color: '#00d4ff', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          ⏱ 时间轴
        </span>
        <span style={{ fontSize: 11, color: '#c9d1d9', fontWeight: 600 }}>
          {format(timeline.currentDate, 'yyyy-MM-dd HH:mm')}
        </span>
        <div style={{ flex: 1 }} />
        {/* Speed */}
        <span style={{ fontSize: 10, color: '#445566' }}>速度:</span>
        {[0.5, 1, 2, 4].map(s => (
          <button key={s} onClick={() => onChange({ speedMultiplier: s })}
            style={{
              padding: '1px 6px', fontSize: 10, borderRadius: 2, cursor: 'pointer',
              background: timeline.speedMultiplier === s ? '#00d4ff22' : 'transparent',
              border: `1px solid ${timeline.speedMultiplier === s ? '#00d4ff' : '#1e2d40'}`,
              color: timeline.speedMultiplier === s ? '#00d4ff' : '#556677',
            }}>{s}x</button>
        ))}
        {/* Play/Pause */}
        <button
          onClick={() => onChange({ playing: !timeline.playing })}
          style={{
            padding: '2px 10px', fontSize: 11, borderRadius: 2, cursor: 'pointer',
            background: timeline.playing ? '#ff6b3522' : '#00d4ff22',
            border: `1px solid ${timeline.playing ? '#ff6b35' : '#00d4ff'}`,
            color: timeline.playing ? '#ff6b35' : '#00d4ff',
          }}
        >
          {timeline.playing ? '⏸ 暂停' : '▶ 播放'}
        </button>
        <button
          onClick={() => onChange({ currentDate: new Date(), playing: false })}
          style={{
            padding: '2px 8px', fontSize: 10, borderRadius: 2, cursor: 'pointer',
            background: 'transparent', border: '1px solid #1e2d40', color: '#556677',
          }}
        >⏭ 当前</button>
      </div>

      {/* Track */}
      <div style={{ padding: '8px 12px 4px' }}>
        <div
          ref={trackRef}
          onMouseDown={handleMouseDown}
          style={{
            position: 'relative', height: 40, cursor: 'pointer', userSelect: 'none',
          }}
        >
          {/* Background track */}
          <div style={{
            position: 'absolute', top: '50%', left: 0, right: 0, height: 2,
            background: '#1e2d40', transform: 'translateY(-50%)',
          }} />
          {/* Progress fill */}
          <div style={{
            position: 'absolute', top: '50%', left: 0, width: `${progress * 100}%`, height: 2,
            background: '#00d4ff', transform: 'translateY(-50%)',
          }} />

          {/* Event dots */}
          {events.map(e => {
            if (!e.occurred_at) return null;
            const pos = differenceInHours(new Date(e.occurred_at), timeline.startDate) / totalHours;
            if (pos < 0 || pos > 1) return null;
            const color = EVENT_COLORS[e.event_type] || '#888';
            const isPast = new Date(e.occurred_at) <= timeline.currentDate;
            return (
              <div
                key={e.id}
                title={`${e.title} (${format(new Date(e.occurred_at), 'MM-dd HH:mm')})`}
                style={{
                  position: 'absolute', top: '50%', left: `${pos * 100}%`,
                  width: Math.max(4, e.severity * 2), height: Math.max(4, e.severity * 2),
                  background: isPast ? color : color + '55',
                  border: `1px solid ${color}`,
                  borderRadius: '50%', transform: 'translate(-50%, -50%)',
                  cursor: 'pointer', zIndex: 2,
                  transition: 'opacity 0.3s',
                }}
              />
            );
          })}

          {/* Cursor */}
          <div style={{
            position: 'absolute', top: 0, bottom: 0, left: `${progress * 100}%`,
            width: 2, background: '#00d4ff', transform: 'translateX(-50%)',
            boxShadow: '0 0 6px #00d4ff',
          }}>
            <div style={{
              position: 'absolute', bottom: -4, left: '50%', transform: 'translateX(-50%)',
              width: 8, height: 8, background: '#00d4ff', borderRadius: '50%',
            }} />
          </div>
        </div>

        {/* Date labels */}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#334455', marginTop: 2 }}>
          <span>{format(timeline.startDate, 'MM-dd')}</span>
          <span>{format(addHours(timeline.startDate, totalHours * 0.25), 'MM-dd')}</span>
          <span>{format(addHours(timeline.startDate, totalHours * 0.5), 'MM-dd')}</span>
          <span>{format(addHours(timeline.startDate, totalHours * 0.75), 'MM-dd')}</span>
          <span>{format(timeline.endDate, 'MM-dd')}</span>
        </div>
      </div>
    </div>
  );
}
