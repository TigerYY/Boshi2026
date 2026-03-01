import { useState, useEffect } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { fetchSources, updateSource, triggerRefresh, fetchSystemStatus, fetchOllamaHealth } from '../../api/client';
import type { ScraperSource, SystemStatus } from '../../api/types';
import type { RefreshPhase } from '../../App';

const PHASE_LABELS: Record<RefreshPhase, string> = {
  idle: '⚡ 立即刷新全部',
  scraping: '⟳ 抓取新闻中...',
  analyzing: '⟳ AI 分析新闻...',
  reporting: '⟳ 生成战场报告...',
};

const PHASE_HINTS: Partial<Record<RefreshPhase, string>> = {
  scraping: '正在从各数据源抓取最新新闻',
  analyzing: 'AI 正在逐条处理新闻摘要',
  reporting: 'AI 正在生成战场综述报告（约1-2分钟）',
};

interface Props {
  autoRefresh: boolean;
  onAutoRefreshChange: (v: boolean) => void;
  refreshInterval: number;
  onIntervalChange: (v: number) => void;
  refreshPhase: RefreshPhase;
  onRefreshStart: () => void;
}

export default function ControlPanel({ autoRefresh, onAutoRefreshChange, refreshInterval, onIntervalChange, refreshPhase, onRefreshStart }: Props) {
  const [sources, setSources] = useState<ScraperSource[]>([]);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<'ok' | 'unavailable' | 'loading'>('loading');

  const isRefreshing = refreshPhase !== 'idle';

  const load = async () => {
    try {
      const [s, st, ol] = await Promise.all([
        fetchSources(),
        fetchSystemStatus(),
        fetchOllamaHealth(),
      ]);
      setSources(s);
      setStatus(st);
      setOllamaStatus(ol.status as 'ok' | 'unavailable');
    } catch { /* ignore */ }
  };

  useEffect(() => { load(); }, []);

  // Reload stats when refresh completes
  useEffect(() => {
    if (refreshPhase === 'idle') load();
  }, [refreshPhase]);

  const handleToggleSource = async (sid: string, enabled: boolean) => {
    await updateSource(sid, { enabled });
    setSources(prev => prev.map(s => s.source_id === sid ? { ...s, enabled } : s));
  };

  const handleRefreshAll = async () => {
    onRefreshStart();
    await triggerRefresh();
  };

  const TIER_LABELS: Record<number, string> = { 1: '一级', 2: '二级', 3: '国内' };
  const TIER_COLORS: Record<number, string> = { 1: '#00d4ff', 2: '#9c66ff', 3: '#cc8800' };

  const grouped = sources.reduce((acc, s) => {
    const tier = s.source_id === 'reuters_world' || s.source_id === 'bbc_world' || s.source_id === 'aljazeera' || s.source_id === 'apnews' || s.source_id === 'isw' ? 1
      : s.source_id === 'globaltimes' || s.source_id === 'xinhua' ? 3 : 2;
    if (!acc[tier]) acc[tier] = [];
    acc[tier].push(s);
    return acc;
  }, {} as Record<number, ScraperSource[]>);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
      {/* System Status */}
      <div style={{ padding: '10px', borderBottom: '1px solid #1e2d40' }}>
        <div style={{ fontSize: 10, color: '#445566', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>系统状态</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <StatCard label="新闻总数" value={status?.news_total ?? '…'} color="#00d4ff" />
          <StatCard label="事件总数" value={status?.events_total ?? '…'} color="#ff6b35" />
          <StatCard label="待处理" value={status?.news_unprocessed ?? '…'} color="#ffdd00" />
          <StatCard
            label="Ollama AI"
            value={ollamaStatus === 'ok' ? '在线' : ollamaStatus === 'unavailable' ? '离线' : '...'}
            color={ollamaStatus === 'ok' ? '#00ff88' : '#ff2244'}
          />
        </div>
      </div>

      {/* Auto Refresh */}
      <div style={{ padding: '10px', borderBottom: '1px solid #1e2d40' }}>
        <div style={{ fontSize: 10, color: '#445566', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>更新控制</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: '#8b9ab0', flex: 1 }}>自动更新</span>
          <button onClick={() => onAutoRefreshChange(!autoRefresh)}
            style={{
              width: 40, height: 20, borderRadius: 10, display: 'flex', alignItems: 'center',
              background: autoRefresh ? '#00d4ff' : '#1e2d40', border: 'none', cursor: 'pointer', padding: '0 3px',
            }}>
            <span style={{
              width: 14, height: 14, borderRadius: '50%', background: '#fff',
              transform: autoRefresh ? 'translateX(20px)' : 'translateX(0)', transition: 'transform 0.2s',
            }} />
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: '#8b9ab0', flex: 1 }}>间隔 (分钟)</span>
          {[5, 15, 30, 60].map(i => (
            <button key={i} onClick={() => onIntervalChange(i)}
              style={{
                padding: '2px 6px', fontSize: 10, borderRadius: 2, cursor: 'pointer',
                background: refreshInterval === i ? '#00d4ff22' : 'transparent',
                border: `1px solid ${refreshInterval === i ? '#00d4ff' : '#1e2d40'}`,
                color: refreshInterval === i ? '#00d4ff' : '#556677',
              }}>{i}</button>
          ))}
        </div>

        <button onClick={handleRefreshAll} disabled={isRefreshing}
          style={{
            width: '100%', padding: '7px', fontSize: 11, cursor: isRefreshing ? 'not-allowed' : 'pointer',
            background: isRefreshing ? '#1e2d40' : '#00ff8811',
            border: `1px solid ${isRefreshing ? '#1e2d40' : '#00ff88'}`,
            color: isRefreshing ? '#445566' : '#00ff88', borderRadius: 3, fontFamily: 'inherit',
          }}>
          {PHASE_LABELS[refreshPhase]}
        </button>
        {PHASE_HINTS[refreshPhase] && (
          <div style={{ fontSize: 9, color: '#334455', marginTop: 4, textAlign: 'center' }}>
            {PHASE_HINTS[refreshPhase]}
          </div>
        )}
      </div>

      {/* Source List */}
      <div style={{ padding: '10px', flex: 1 }}>
        <div style={{ fontSize: 10, color: '#445566', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>数据源管理</div>
        {[1, 2, 3].map(tier => (
          grouped[tier] && (
            <div key={tier} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 9, color: TIER_COLORS[tier], fontWeight: 600, marginBottom: 4, letterSpacing: '0.05em' }}>
                {TIER_LABELS[tier]}来源
              </div>
              {grouped[tier].map(src => (
                <SourceRow key={src.source_id} source={src} onToggle={handleToggleSource} />
              ))}
            </div>
          )
        ))}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div style={{
      padding: '8px', background: '#0a0e14', border: '1px solid #1e2d40', borderRadius: 3,
    }}>
      <div style={{ fontSize: 9, color: '#445566', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function SourceRow({ source, onToggle }: { source: ScraperSource; onToggle: (id: string, v: boolean) => void }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px',
      borderRadius: 3, marginBottom: 2,
      background: source.enabled ? 'transparent' : 'rgba(0,0,0,0.3)',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: source.enabled ? '#c9d1d9' : '#445566', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {source.source_name}
        </div>
        {source.last_success && (
          <div style={{ fontSize: 9, color: '#334455' }}>
            {formatDistanceToNow(new Date(source.last_success), { locale: zhCN, addSuffix: true })}
            {source.last_count > 0 && ` · +${source.last_count}`}
          </div>
        )}
        {source.error_msg && (
          <div style={{ fontSize: 9, color: '#ff2244' }} title={source.error_msg}>⚠ 错误</div>
        )}
      </div>
      <button onClick={() => onToggle(source.source_id, !source.enabled)}
        style={{
          width: 32, height: 16, borderRadius: 8, display: 'flex', alignItems: 'center',
          background: source.enabled ? '#00d4ff' : '#1e2d40', border: 'none', cursor: 'pointer', padding: '0 2px',
          flexShrink: 0,
        }}>
        <span style={{
          width: 12, height: 12, borderRadius: '50%', background: '#fff',
          transform: source.enabled ? 'translateX(16px)' : 'translateX(0)', transition: 'transform 0.2s',
        }} />
      </button>
    </div>
  );
}
