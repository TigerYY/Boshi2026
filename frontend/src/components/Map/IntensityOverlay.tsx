import { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { fetchIntensityTrend } from '../../api/client';
import type { IntensityTrend } from '../../api/types';

interface Props {
  timelineActive?: boolean;
  aiIntensityScore?: number | null;  // 0-10 from latest AnalysisReport
}

export default function IntensityOverlay({ timelineActive = false, aiIntensityScore = null }: Props) {
  const [trend, setTrend] = useState<IntensityTrend | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    fetchIntensityTrend(7).then(setTrend).catch(() => { });
    // Refresh every 10 minutes
    const t = setInterval(() => {
      fetchIntensityTrend(7).then(setTrend).catch(() => { });
    }, 10 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  // Use AI intensity score (0-10) for the headline number; fall back to daily last value
  const displayScore = aiIntensityScore ?? null;
  const scoreColor = displayScore == null ? '#556677'
    : displayScore >= 8 ? '#ff2244'
      : displayScore >= 6 ? '#ff6b35'
        : displayScore >= 4 ? '#ffdd00'
          : '#00ff88';

  // When timeline is open (~100px tall), shift up to avoid overlap
  const bottomOffset = timelineActive ? 114 : 10;

  return (
    <div style={{
      position: 'absolute',
      bottom: bottomOffset,
      left: 10,
      zIndex: 900,
      transition: 'bottom 0.25s ease',
      background: 'rgba(10,14,20,0.88)',
      border: '1px solid #1e2d40',
      borderRadius: 4,
      minWidth: collapsed ? 'auto' : 210,
      userSelect: 'none',
    }}>
      {/* Header */}
      <div
        onClick={() => setCollapsed(c => !c)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 8px', cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: 9, color: '#445566', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          冲突烈度
        </span>
        {displayScore != null && (
          <span style={{ fontSize: 12, fontWeight: 700, color: scoreColor }}>
            {displayScore.toFixed(1)}
            <span style={{ fontSize: 8, color: '#445566', fontWeight: 400, marginLeft: 2 }}>/10</span>
          </span>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 9, color: '#334455' }}>{collapsed ? '▶' : '▼'}</span>
      </div>

      {/* Sparkline chart */}
      {!collapsed && trend && trend.daily_intensity.length > 0 && (
        <div style={{ padding: '0 6px 6px' }}>
          <div style={{ fontSize: 8, color: '#334455', marginBottom: 2 }}>活跃指数趋势（近7天）</div>
          <ResponsiveContainer width="100%" height={60}>
            <AreaChart data={trend.daily_intensity} margin={{ top: 2, right: 2, left: -32, bottom: 0 }}>
              <defs>
                <linearGradient id="overlayGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={scoreColor} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={scoreColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tick={{ fill: '#334455', fontSize: 8 }}
                tickFormatter={d => d.slice(5)}
                interval="preserveStartEnd"
              />
              <Tooltip
                contentStyle={{ background: '#0d1117', border: '1px solid #1e2d40', fontSize: 9 }}
                labelStyle={{ color: '#556677' }}
                itemStyle={{ color: scoreColor }}
                formatter={(v: any) => [Number(v).toFixed(1), '烈度']}
              />
              <Area
                type="monotone"
                dataKey="score"
                stroke={scoreColor}
                fill="url(#overlayGrad)"
                strokeWidth={1.5}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {!collapsed && (!trend || trend.daily_intensity.length === 0) && (
        <div style={{ padding: '0 8px 6px', fontSize: 9, color: '#334455' }}>暂无数据</div>
      )}
    </div>
  );
}
