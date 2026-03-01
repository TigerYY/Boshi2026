import { useState, useEffect } from 'react';
import { format } from 'date-fns';

interface Props {
  ollamaOk: boolean;
  autoRefresh: boolean;
  notifications: string[];
  onToggleTimeline: () => void;
  timelineActive: boolean;
}

export default function Header({ ollamaOk, autoRefresh, notifications, onToggleTimeline, timelineActive }: Props) {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{
      height: 44,
      background: 'rgba(10, 14, 20, 0.96)',
      borderBottom: '1px solid #1e2d40',
      display: 'flex', alignItems: 'center', padding: '0 14px', gap: 14, flexShrink: 0,
      position: 'relative', zIndex: 2000,
    }}>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 4, background: 'rgba(255,34,68,0.15)',
          border: '1px solid #ff224444', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14,
        }}>⚔</div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#c9d1d9', letterSpacing: '0.05em' }}>
            BOSHI · 博视
          </div>
          <div style={{ fontSize: 9, color: '#445566', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            美伊战争态势系统
          </div>
        </div>
      </div>

      <div style={{ width: 1, height: 24, background: '#1e2d40', marginLeft: 4 }} />

      {/* Status badges */}
      <div style={{ display: 'flex', gap: 6 }}>
        <StatusBadge
          label="LIVE"
          active={autoRefresh}
          activeColor="#ff2244"
          pulse
        />
        <StatusBadge
          label="AI"
          active={ollamaOk}
          activeColor="#00d4ff"
        />
      </div>

      <div style={{ flex: 1 }} />

      {/* Notifications ticker */}
      {notifications.length > 0 && (
        <div style={{
          flex: 2, overflow: 'hidden', maxWidth: 400,
          background: '#0a0e14', border: '1px solid #1e2d40',
          borderRadius: 2, padding: '2px 8px',
        }}>
          <div style={{ fontSize: 10, color: '#00d4ff44', display: 'inline', marginRight: 8 }}>
            ▶ SYS
          </div>
          <span style={{ fontSize: 10, color: '#556677', whiteSpace: 'nowrap' }}>
            {notifications[0]}
          </span>
        </div>
      )}

      <div style={{ flex: 1 }} />

      {/* Timeline toggle */}
      <button onClick={onToggleTimeline}
        style={{
          padding: '4px 10px', fontSize: 10, cursor: 'pointer', borderRadius: 2,
          background: timelineActive ? '#00d4ff22' : 'transparent',
          border: `1px solid ${timelineActive ? '#00d4ff' : '#1e2d40'}`,
          color: timelineActive ? '#00d4ff' : '#556677', fontFamily: 'inherit',
        }}>
        ⏱ 时间轴 {timelineActive ? '▲' : '▼'}
      </button>

      <div style={{ width: 1, height: 24, background: '#1e2d40' }} />

      {/* Clock */}
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#00d4ff', letterSpacing: '0.05em' }}>
          {format(time, 'HH:mm:ss')}
        </div>
        <div style={{ fontSize: 9, color: '#445566' }}>
          {format(time, 'yyyy-MM-dd')} UTC
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ label, active, activeColor, pulse }: {
  label: string; active: boolean; activeColor: string; pulse?: boolean;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px',
      borderRadius: 2, border: `1px solid ${active ? activeColor + '44' : '#1e2d40'}`,
      background: active ? activeColor + '11' : '#0a0e14',
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: active ? activeColor : '#334455',
        ...(pulse && active ? { animation: 'pulse 1.5s infinite' } : {}),
      }} />
      <span style={{ fontSize: 9, fontWeight: 700, color: active ? activeColor : '#445566', letterSpacing: '0.1em' }}>
        {label}
      </span>
    </div>
  );
}
