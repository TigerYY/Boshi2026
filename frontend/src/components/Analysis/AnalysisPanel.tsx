import { useState, useEffect } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { fetchIntensityTrend } from '../../api/client';
import type { IntensityTrend, AnalysisReport } from '../../api/types';
import MacroRadar from './MacroRadar';

const EVENT_COLORS: Record<string, string> = {
  airstrike: '#ff6b35', missile: '#ff2244', naval: '#00d4ff',
  land: '#00ff88', diplomacy: '#9c66ff', sanction: '#ffdd00', other: '#888',
};

const EVENT_LABELS: Record<string, string> = {
  airstrike: '空袭', missile: '导弹', naval: '海战',
  land: '地面', diplomacy: '外交', sanction: '制裁', other: '其他',
};

interface AnalysisPanelProps {
  report: AnalysisReport | null;
  financeData: Record<string, { symbol: string; price: number; change: number }> | null;
}

export default function AnalysisPanel({ report, financeData }: AnalysisPanelProps) {
  const [trend, setTrend] = useState<IntensityTrend | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);

  useEffect(() => {
    setLoading(true);
    fetchIntensityTrend(days)
      .then(setTrend)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [days]);

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '10px 10px 100px 10px', boxSizing: 'border-box' }}>
      {/* Section header */}
      <div style={{ fontSize: 10, color: '#445566', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
        数据分析
      </div>

      {/* Day range toggle */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {[7, 14, 30].map(d => (
          <button key={d} onClick={() => setDays(d)}
            style={{
              padding: '2px 10px', fontSize: 10, borderRadius: 2, cursor: 'pointer',
              background: days === d ? '#00d4ff22' : 'transparent',
              border: `1px solid ${days === d ? '#00d4ff' : '#1e2d40'}`,
              color: days === d ? '#00d4ff' : '#556677',
              fontFamily: 'inherit',
            }}>{d}天</button>
        ))}
      </div>

      {loading && (
        <div style={{ color: '#445566', fontSize: 12, textAlign: 'center', padding: 20 }}>加载中...</div>
      )}

      {!loading && trend && (
        <>
          {/* Intensity trend area chart */}
          <div style={{ fontSize: 10, color: '#445566', marginBottom: 6 }}>每日冲突烈度积分</div>
          <ResponsiveContainer width="100%" height={130}>
            <AreaChart data={trend.daily_intensity} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="intensityGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ff6b35" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#ff6b35" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fill: '#445566', fontSize: 9 }} tickFormatter={d => d.slice(5)} />
              <YAxis tick={{ fill: '#445566', fontSize: 9 }} />
              <Tooltip
                contentStyle={{
                  background: 'rgba(13, 17, 23, 0.95)',
                  border: '1px solid #30363d',
                  borderRadius: 4,
                  fontSize: 10,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
                }}
                labelStyle={{ color: '#00d4ff', marginBottom: 4 }}
                itemStyle={{ color: '#ff6b35', fontSize: 10, padding: 0 }}
              />
              <Area type="monotone" dataKey="score" stroke="#ff6b35" fill="url(#intensityGrad)" strokeWidth={1.5} />
            </AreaChart>
          </ResponsiveContainer>

          {/* Event type distribution pie */}
          <div style={{ fontSize: 10, color: '#445566', marginTop: 16, marginBottom: 8 }}>事件类型分布 (过去{days}天)</div>
          <div style={{ background: '#0a0e14', border: '1px solid #1e2d4088', borderRadius: 4, padding: '5px 0' }}>
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie
                  data={trend.event_type_dist.map(d => ({
                    ...d,
                    name: EVENT_LABELS[d.type] || d.type,
                  }))}
                  cx="35%" cy="50%" innerRadius={42} outerRadius={62}
                  paddingAngle={3}
                  stroke="none"
                  dataKey="count" nameKey="name"
                >
                  {trend.event_type_dist.map(entry => (
                    <Cell key={entry.type} fill={EVENT_COLORS[entry.type] || '#888'} />
                  ))}
                </Pie>
                <Legend
                  layout="vertical" verticalAlign="middle" align="right"
                  iconType="circle" iconSize={8}
                  formatter={(v, entry: any) => (
                    <span style={{ fontSize: 11, color: '#8b9ab0', marginLeft: 2 }}>
                      {v} <span style={{ color: '#00d4ff', fontSize: 10, marginLeft: 8, opacity: 0.8 }}>{entry.payload.count}</span>
                    </span>
                  )}
                  wrapperStyle={{ paddingRight: 15 }}
                />
                <Tooltip
                  contentStyle={{
                    background: 'rgba(13, 17, 23, 0.95)',
                    border: '1px solid #30363d',
                    borderRadius: 4,
                    fontSize: 10,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
                  }}
                  itemStyle={{ color: '#e6edf3', fontSize: 10, padding: '2px 0' }}
                  labelStyle={{ display: 'none' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Summary stats */}
          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <StatCard
              label="平均烈度"
              value={trend.daily_intensity.length > 0
                ? (trend.daily_intensity.reduce((s, d) => s + d.score, 0) / trend.daily_intensity.length).toFixed(1)
                : '—'}
              color="#ff6b35"
            />
            <StatCard
              label="总事件数"
              value={trend.event_type_dist.reduce((s, d) => s + d.count, 0)}
              color="#00d4ff"
            />
          </div>

          {/* Doomsday Escalation Radar */}
          <MacroRadar report={report} financeData={financeData} />
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div style={{
      padding: '8px', background: '#0a0e14', border: '1px solid #1e2d40', borderRadius: 3,
    }}>
      <div style={{ fontSize: 9, color: '#445566', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}
