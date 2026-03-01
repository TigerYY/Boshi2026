import { useState, useEffect } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { fetchLatestReport, fetchIntensityTrend, triggerAnalysis } from '../../api/client';
import type { AnalysisReport, IntensityTrend } from '../../api/types';

const EVENT_COLORS: Record<string, string> = {
  airstrike: '#ff6b35', missile: '#ff2244', naval: '#00d4ff',
  land: '#00ff88', diplomacy: '#9c66ff', sanction: '#ffdd00', other: '#888',
};

const EVENT_LABELS: Record<string, string> = {
  airstrike: '空袭', missile: '导弹', naval: '海战',
  land: '地面', diplomacy: '外交', sanction: '制裁', other: '其他',
};

function IntensityGauge({ score }: { score: number }) {
  const pct = score / 10;
  const color = score >= 8 ? '#ff2244' : score >= 6 ? '#ff6b35' : score >= 4 ? '#ffdd00' : '#00ff88';
  const label = score >= 8 ? '极高' : score >= 6 ? '高' : score >= 4 ? '中等' : '低';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ flex: 1, height: 8, background: '#1e2d40', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{
          width: `${pct * 100}%`, height: '100%', borderRadius: 4,
          background: `linear-gradient(90deg, #00ff88, ${color})`,
          transition: 'width 0.5s',
        }} />
      </div>
      <span style={{ fontSize: 18, fontWeight: 700, color, minWidth: 32, textAlign: 'right' }}>
        {score.toFixed(1)}
      </span>
      <span style={{
        fontSize: 10, padding: '1px 6px', borderRadius: 2,
        background: color + '22', color, border: `1px solid ${color}44`,
      }}>{label}</span>
    </div>
  );
}

export default function AnalysisPanel() {
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [trend, setTrend] = useState<IntensityTrend | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [days, setDays] = useState(7);
  const [tab, setTab] = useState<'summary' | 'trend' | 'hotspot'>('summary');

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [r, t] = await Promise.all([
          fetchLatestReport(),
          fetchIntensityTrend(days),
        ]);
        setReport('id' in r ? r : null);
        setTrend(t);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, [days]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await triggerAnalysis();
      setTimeout(async () => {
        const r = await fetchLatestReport();
        if ('id' in r) setReport(r);
        setGenerating(false);
      }, 3000);
    } catch {
      setGenerating(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #1e2d40' }}>
        {([['summary', '态势综述'], ['trend', '烈度趋势'], ['hotspot', '热点区域']] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            style={{
              flex: 1, padding: '7px 4px', fontSize: 10, cursor: 'pointer',
              background: tab === t ? '#00d4ff11' : 'transparent',
              border: 'none', borderBottom: tab === t ? '2px solid #00d4ff' : '2px solid transparent',
              color: tab === t ? '#00d4ff' : '#556677',
              fontFamily: 'inherit', fontWeight: tab === t ? 600 : 400,
            }}>{label}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
        {loading && <div style={{ color: '#445566', fontSize: 12, textAlign: 'center', padding: 20 }}>加载中...</div>}

        {/* Summary Tab */}
        {tab === 'summary' && !loading && (
          <div>
            {report ? (
              <>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10, color: '#445566', marginBottom: 4 }}>冲突烈度指数</div>
                  <IntensityGauge score={report.intensity_score} />
                </div>

                {report.content && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, color: '#00d4ff', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      AI 战场综述
                    </div>
                    <div style={{
                      fontSize: 11, color: '#8b9ab0', lineHeight: 1.7,
                      padding: '8px 10px', background: '#0a0e14',
                      border: '1px solid #1e2d40', borderRadius: 3,
                    }}>
                      {report.content}
                    </div>
                  </div>
                )}

                {report.generated_at && (
                  <div style={{ fontSize: 9, color: '#334455', marginBottom: 8 }}>
                    生成时间: {new Date(report.generated_at).toLocaleString('zh-CN')}
                  </div>
                )}
              </>
            ) : (
              <div style={{ color: '#334455', fontSize: 11, padding: '10px 0' }}>暂无分析报告</div>
            )}

            <button
              onClick={handleGenerate}
              disabled={generating}
              style={{
                width: '100%', padding: '7px', fontSize: 11, cursor: 'pointer',
                background: generating ? '#1e2d40' : '#00d4ff11',
                border: `1px solid ${generating ? '#1e2d40' : '#00d4ff'}`,
                color: generating ? '#445566' : '#00d4ff',
                borderRadius: 3, fontFamily: 'inherit',
              }}
            >
              {generating ? '⟳ AI 分析中...' : '⚡ 立即生成分析'}
            </button>
          </div>
        )}

        {/* Trend Tab */}
        {tab === 'trend' && !loading && trend && (
          <div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              {[7, 14, 30].map(d => (
                <button key={d} onClick={() => setDays(d)}
                  style={{
                    padding: '2px 8px', fontSize: 10, borderRadius: 2, cursor: 'pointer',
                    background: days === d ? '#00d4ff22' : 'transparent',
                    border: `1px solid ${days === d ? '#00d4ff' : '#1e2d40'}`,
                    color: days === d ? '#00d4ff' : '#556677',
                  }}>{d}天</button>
              ))}
            </div>

            <div style={{ fontSize: 10, color: '#445566', marginBottom: 6 }}>每日冲突烈度积分</div>
            <ResponsiveContainer width="100%" height={120}>
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
                  contentStyle={{ background: '#0d1117', border: '1px solid #1e2d40', fontSize: 10 }}
                  labelStyle={{ color: '#00d4ff' }}
                  itemStyle={{ color: '#ff6b35' }}
                />
                <Area type="monotone" dataKey="score" stroke="#ff6b35" fill="url(#intensityGrad)" strokeWidth={1.5} />
              </AreaChart>
            </ResponsiveContainer>

            <div style={{ fontSize: 10, color: '#445566', marginTop: 14, marginBottom: 6 }}>事件类型分布</div>
            <ResponsiveContainer width="100%" height={140}>
              <PieChart>
                <Pie
                  data={trend.event_type_dist.map(d => ({
                    ...d,
                    name: EVENT_LABELS[d.type] || d.type,
                  }))}
                  cx="50%" cy="50%" innerRadius={35} outerRadius={55}
                  dataKey="count" nameKey="name"
                >
                  {trend.event_type_dist.map((entry) => (
                    <Cell key={entry.type} fill={EVENT_COLORS[entry.type] || '#888'} />
                  ))}
                </Pie>
                <Legend
                  iconType="circle" iconSize={8}
                  formatter={(v) => <span style={{ fontSize: 10, color: '#8b9ab0' }}>{v}</span>}
                />
                <Tooltip
                  contentStyle={{ background: '#0d1117', border: '1px solid #1e2d40', fontSize: 10 }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Hotspot Tab */}
        {tab === 'hotspot' && !loading && report && (
          <div>
            <div style={{ fontSize: 10, color: '#445566', marginBottom: 8 }}>当前热点区域 (AI识别)</div>
            {report.hotspots.length === 0 && (
              <div style={{ fontSize: 11, color: '#334455' }}>暂无热点数据，请先生成分析报告</div>
            )}
            {report.hotspots.map((h, i) => (
              <div key={i} style={{
                padding: '8px 10px', marginBottom: 6,
                background: '#0a0e14', border: '1px solid #1e2d40', borderRadius: 3,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#c9d1d9' }}>{h.name}</span>
                  <div style={{ flex: 1 }} />
                  <span style={{
                    fontSize: 10, padding: '1px 6px', borderRadius: 2,
                    background: h.score >= 7 ? '#ff224422' : '#ff6b3522',
                    color: h.score >= 7 ? '#ff2244' : '#ff6b35',
                    border: `1px solid ${h.score >= 7 ? '#ff224444' : '#ff6b3544'}`,
                  }}>热度 {h.score.toFixed(0)}</span>
                </div>
                <div style={{ fontSize: 10, color: '#8b9ab0', lineHeight: 1.5 }}>{h.reason}</div>
                <div style={{ fontSize: 9, color: '#334455', marginTop: 4 }}>
                  {h.lat.toFixed(2)}°N {h.lon.toFixed(2)}°E
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
