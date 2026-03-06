import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { fetchSources } from '../../api/client';
import Modal from './Modal';
import OsintTerminal from '../Analysis/OsintTerminal';

interface Props {
  ollamaOk: boolean;
  autoRefresh: boolean;
  notifications: string[];
  onToggleTimeline: () => void;
  timelineActive: boolean;
  refreshTrigger?: number;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '暂无数据';
  // Ensure the string is parsed as UTC. If the backend omits a timezone suffix,
  // append 'Z' so the browser doesn't treat it as local time (avoids 8-hour offset
  // for UTC+8 users).
  const utcStr = /[Z+]/.test(dateStr.slice(-6)) ? dateStr : dateStr + 'Z';
  const diff = Math.floor((Date.now() - new Date(utcStr).getTime()) / 1000);
  if (diff < 60) return `${diff}秒前`;
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}分钟前`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (remMins === 0) return `${hrs}小时前`;
  return `${hrs}小时${remMins}分钟前`;
}

export default function Header({ ollamaOk, autoRefresh, notifications, onToggleTimeline, timelineActive, refreshTrigger }: Props) {
  const [time, setTime] = useState(new Date());
  const [lastSuccess, setLastSuccess] = useState<string | null>(null);
  const [showOsint, setShowOsint] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const load = () =>
      fetchSources().then(sources => {
        const times = sources.map(s => s.last_success).filter(Boolean) as string[];
        if (times.length) setLastSuccess(times.sort().at(-1) ?? null);
      }).catch(() => { });
    load();
    const t = setInterval(load, 2 * 60 * 1000);
    return () => clearInterval(t);
    // Re-fetch immediately whenever a manual refresh completes (refreshTrigger bumps)
  }, [refreshTrigger]);

  return (
    <div className="hud-panel" style={{
      height: 44,
      background: 'rgba(8, 12, 18, 0.98)',
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
            BOSHI · 波斯
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

      {/* Last update time */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ fontSize: 9, color: '#334455' }}>◎</span>
        <div>
          <div style={{ fontSize: 9, color: '#445566', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            数据更新
          </div>
          <div style={{ fontSize: 10, color: lastSuccess ? '#00d4ff99' : '#334455', fontVariantNumeric: 'tabular-nums' }}>
            {timeAgo(lastSuccess)}
          </div>
        </div>
      </div>

      <div style={{ width: 1, height: 24, background: '#1e2d40' }} />

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

      {/* Upgrade plan link */}
      <a href="/system-guide.html" target="_blank" rel="noreferrer"
        title="BoShi 系统文档与升级路线图"
        style={{
          padding: '4px 10px', fontSize: 10, cursor: 'pointer', borderRadius: 2,
          background: 'transparent',
          border: '1px solid #1e2d40',
          color: '#556677', fontFamily: 'inherit',
          textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4,
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#9c66ff'; (e.currentTarget as HTMLElement).style.color = '#9c66ff'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#1e2d40'; (e.currentTarget as HTMLElement).style.color = '#556677'; }}
      >
        📋 升级规划
      </a>

      {/* Military Interaction Terminal */}
      <button
        onClick={() => setShowOsint(true)}
        title="军情互动终端 (OSINT Chat)"
        style={{
          padding: '4px 10px', fontSize: 10, cursor: 'pointer', borderRadius: 2,
          background: 'rgba(0, 212, 255, 0.05)',
          border: '1px solid #00d4ff44',
          color: '#00ff88', fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', gap: 6,
          transition: 'all 0.2s',
          marginRight: 4
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#00d4ff'; (e.currentTarget as HTMLElement).style.boxShadow = '0 0 8px rgba(0, 212, 255, 0.2)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#00d4ff44'; (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}
      >
        <span style={{ fontSize: 13 }}>👨‍✈️</span> 军情互动
      </button>

      <Modal
        isOpen={showOsint}
        onClose={() => setShowOsint(false)}
        title="OSINT 军情战略指挥终端"
        width={300}
        height="60vh"
      >
        <OsintTerminal />
      </Modal>

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
      {pulse && active
        ? <span className="live-dot" />
        : <span style={{ width: 6, height: 6, borderRadius: '50%', background: active ? activeColor : '#334455', display: 'inline-block' }} />
      }
      <span style={{ fontSize: 9, fontWeight: 700, color: active ? activeColor : '#445566', letterSpacing: '0.1em' }}>
        {label}
      </span>
    </div>
  );
}
