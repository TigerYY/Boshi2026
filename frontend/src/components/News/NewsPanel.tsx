import React, { useState, useEffect, useCallback } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { fetchNews, fetchLatestReport, triggerAnalysis } from '../../api/client';
import type { NewsItem, AnalysisReport } from '../../api/types';


const CATEGORY_LABELS: Record<string, string> = {
  airstrike: '空袭', missile: '导弹', naval: '海战', land: '地面',
  diplomacy: '外交', sanction: '制裁', movement: '调动', other: '其他',
};

const CATEGORY_COLORS: Record<string, string> = {
  airstrike: '#ff6b35', missile: '#ff2244', naval: '#00d4ff',
  land: '#00ff88', diplomacy: '#9c66ff', sanction: '#ffdd00',
  movement: '#44bbff', other: '#888',
};

const SOURCE_TIER_COLORS: Record<number, string> = {
  1: '#00d4ff', 2: '#9c66ff', 3: '#cc8800',
};

interface Props {
  onNewsSelect?: (news: NewsItem) => void;
}

export default function NewsPanel({ onNewsSelect }: Props) {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [breakingOnly, setBreakingOnly] = useState(false);
  // Tab: 'news' | 'summary'
  const [activeTab, setActiveTab] = useState<'news' | 'summary'>('news');

  // Analysis summary state
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchNews({
        page,
        size: 20,
        category: filter !== 'all' ? filter : undefined,
        breaking_only: breakingOnly || undefined,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [page, filter, breakingOnly]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetchLatestReport().then(r => { if ('id' in r) setReport(r); }).catch(() => { });
  }, []);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await triggerAnalysis();
      setTimeout(async () => {
        const r = await fetchLatestReport();
        if ('id' in r) { setReport(r); }
        setGenerating(false);
      }, 3000);
    } catch {
      setGenerating(false);
    }
  };

  const filters = ['all', 'airstrike', 'missile', 'naval', 'land', 'diplomacy', 'sanction'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid #1e2d40', flexShrink: 0 }}>
        <button onClick={() => setActiveTab('news')}
          style={{
            flex: 1, padding: '6px', fontSize: 10, cursor: 'pointer', border: 'none',
            background: activeTab === 'news' ? '#00d4ff11' : 'transparent',
            borderBottom: activeTab === 'news' ? '2px solid #00d4ff' : '2px solid transparent',
            color: activeTab === 'news' ? '#00d4ff' : '#445566',
            fontFamily: 'inherit', letterSpacing: '0.06em',
          }}>
          📰 情报新闻
        </button>
        <button onClick={() => setActiveTab('summary')}
          style={{
            flex: 1, padding: '6px', fontSize: 10, cursor: 'pointer', border: 'none',
            background: activeTab === 'summary' ? '#00d4ff11' : 'transparent',
            borderBottom: activeTab === 'summary' ? '2px solid #00d4ff' : '2px solid transparent',
            color: activeTab === 'summary' ? '#00d4ff' : '#445566',
            fontFamily: 'inherit', letterSpacing: '0.06em',
          }}>
          ⚔ AI战场综述
        </button>
      </div>

      {/* AI 战场综述 tab */}
      {activeTab === 'summary' && (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {report ? (
              <>
                <IntensityGauge score={report.intensity_score} />
                <div>
                  <SectionLabel>综合态势</SectionLabel>
                  <div style={{
                    fontSize: 11, color: '#a8b8cc', lineHeight: 1.85,
                    padding: '10px 12px', background: '#0a0e14',
                    border: '1px solid #1e2d40', borderRadius: 4,
                  }}>
                    {report.content || '暂无综述内容'}
                  </div>
                </div>

                {report.key_developments && report.key_developments.length > 0 && (
                  <div>
                    <SectionLabel>关键进展</SectionLabel>
                    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {report.key_developments.map((d, i) => (
                        <li key={i} style={{
                          display: 'flex', gap: 8, padding: '6px 10px',
                          background: '#0d1520', border: '1px solid #1e2d40', borderRadius: 3,
                          fontSize: 11, color: '#8b9ab0', lineHeight: 1.6,
                        }}>
                          <span style={{ color: '#00d4ff', fontWeight: 700, flexShrink: 0, fontSize: 10, marginTop: 1 }}>
                            {String(i + 1).padStart(2, '0')}
                          </span>
                          {d}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {report.hotspots && report.hotspots.length > 0 && (
                  <div>
                    <SectionLabel>热点区域</SectionLabel>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {report.hotspots.slice(0, 5).map((h, i) => (
                        <div key={i} style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '5px 10px', background: '#0d1520',
                          border: `1px solid ${intensityColor(h.score)}33`, borderRadius: 3,
                        }}>
                          <span style={{
                            width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                            background: intensityColor(h.score),
                          }} />
                          <span style={{ fontSize: 11, color: '#c9d1d9', fontWeight: 600, minWidth: 60 }}>{h.name}</span>
                          <span style={{ fontSize: 10, color: '#667788', flex: 1, lineHeight: 1.4 }}>{h.reason}</span>
                          <span style={{ fontSize: 10, color: intensityColor(h.score), fontWeight: 700, flexShrink: 0 }}>
                            {h.score.toFixed(1)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {report.outlook && (
                  <div>
                    <SectionLabel>态势研判</SectionLabel>
                    <div style={{
                      fontSize: 11, color: '#9c66ff', lineHeight: 1.75,
                      padding: '8px 12px', background: '#0d0a1e',
                      border: '1px solid #9c66ff33', borderRadius: 4,
                      fontStyle: 'italic',
                    }}>
                      {report.outlook}
                    </div>
                  </div>
                )}

                {report.generated_at && (
                  <div style={{ fontSize: 9, color: '#334455' }}>
                    生成于 {new Date(report.generated_at).toLocaleString('zh-CN')}
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 11, color: '#334455', padding: '20px 0', textAlign: 'center' }}>暂无分析报告，点击下方按钮生成</div>
            )}

            <button onClick={handleGenerate} disabled={generating}
              style={{
                width: '100%', padding: '8px', fontSize: 11, cursor: 'pointer',
                background: generating ? '#1e2d40' : '#00d4ff11',
                border: `1px solid ${generating ? '#1e2d40' : '#00d4ff'}`,
                color: generating ? '#445566' : '#00d4ff',
                borderRadius: 3, fontFamily: 'inherit',
              }}>
              {generating ? '⟳ AI 分析中...' : '⚡ 立即生成分析'}
            </button>
          </div>
        </div>
      )}

      {/* News tab */}
      {activeTab === 'news' && (
        <>
          {/* Filters */}
          <div style={{ padding: '6px 8px', borderBottom: '1px solid #1e2d40', display: 'flex', flexWrap: 'wrap', gap: 4, flexShrink: 0 }}>
            {filters.map(f => (
              <button key={f} onClick={() => { setFilter(f); setPage(1); }}
                style={{
                  padding: '2px 8px', fontSize: 10, borderRadius: 2, cursor: 'pointer',
                  background: filter === f ? (CATEGORY_COLORS[f] || '#00d4ff') + '22' : 'transparent',
                  border: `1px solid ${filter === f ? (CATEGORY_COLORS[f] || '#00d4ff') : '#1e2d40'}`,
                  color: filter === f ? (CATEGORY_COLORS[f] || '#00d4ff') : '#556677',
                }}>
                {CATEGORY_LABELS[f] || '全部'}
              </button>
            ))}
            <button onClick={() => setBreakingOnly(b => !b)}
              style={{
                padding: '2px 8px', fontSize: 10, borderRadius: 2, cursor: 'pointer',
                background: breakingOnly ? '#ff224422' : 'transparent',
                border: `1px solid ${breakingOnly ? '#ff2244' : '#1e2d40'}`,
                color: breakingOnly ? '#ff2244' : '#556677',
              }}>
              🔴 突发
            </button>
          </div>

          {/* News List */}
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            {loading && items.length === 0 && (
              <div style={{ padding: 20, textAlign: 'center', color: '#445566', fontSize: 12 }}>加载中...</div>
            )}
            {items.map(item => (
              <NewsCard key={item.id} item={item} onSelect={onNewsSelect} />
            ))}
            {items.length === 0 && !loading && (
              <div style={{ padding: 20, textAlign: 'center', color: '#334455', fontSize: 12 }}>暂无数据</div>
            )}
          </div>

          {/* Pagination */}
          {total > 20 && (
            <div style={{ padding: '6px 8px', borderTop: '1px solid #1e2d40', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: 10, color: '#445566' }}>共 {total} 条</span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
                  style={{ padding: '2px 8px', fontSize: 10, background: 'transparent', border: '1px solid #1e2d40', color: '#556677', cursor: 'pointer', borderRadius: 2 }}>‹</button>
                <span style={{ fontSize: 10, color: '#556677', padding: '2px 6px' }}>{page}</span>
                <button disabled={page * 20 >= total} onClick={() => setPage(p => p + 1)}
                  style={{ padding: '2px 8px', fontSize: 10, background: 'transparent', border: '1px solid #1e2d40', color: '#556677', cursor: 'pointer', borderRadius: 2 }}>›</button>
              </div>
            </div>
          )}

        </>
      )}
      {/* end activeTab === 'news' */}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 9, color: '#445566', fontWeight: 700, letterSpacing: '0.12em',
      textTransform: 'uppercase', marginBottom: 5, paddingLeft: 2,
      display: 'flex', alignItems: 'center', gap: 6,
    }}>
      <div style={{ flex: 1, height: 1, background: '#1e2d40' }} />
      {children}
      <div style={{ flex: 1, height: 1, background: '#1e2d40' }} />
    </div>
  );
}

function intensityColor(score: number) {
  return score >= 8 ? '#ff2244' : score >= 6 ? '#ff6b35' : score >= 4 ? '#ffdd00' : '#00ff88';
}

function IntensityGauge({ score }: { score: number }) {
  const color = intensityColor(score);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 2 }}>
      <div style={{ flex: 1, height: 6, background: '#1e2d40', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{
          width: `${(score / 10) * 100}%`, height: '100%', borderRadius: 3,
          background: `linear-gradient(90deg, #00ff88, ${color})`,
        }} />
      </div>
      <span style={{ fontSize: 16, fontWeight: 700, color, minWidth: 28, textAlign: 'right' }}>
        {score.toFixed(1)}
      </span>
    </div>
  );
}


function NewsCard({ item, onSelect }: { item: NewsItem; onSelect?: (n: NewsItem) => void }) {
  const [expanded, setExpanded] = useState(false);
  const catColor = CATEGORY_COLORS[item.category || 'other'] || '#888';
  const tierColor = SOURCE_TIER_COLORS[item.source_tier] || '#888';

  let displaySummary = item.summary_zh || item.title || '';
  const tags: string[] = [];
  const tagMatch = displaySummary.match(/^\[Tags:\s*(.+?)\]\s*/);
  if (tagMatch) {
    tags.push(...tagMatch[1].split(',').map(s => s.trim()));
    displaySummary = displaySummary.slice(tagMatch[0].length);
  }

  return (
    <div
      onClick={() => { setExpanded(e => !e); onSelect?.(item); }}
      style={{
        padding: '8px 10px', borderBottom: '1px solid #1e2d4033', cursor: 'pointer',
        background: item.is_breaking ? 'rgba(255, 34, 68, 0.04)' : 'transparent',
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = item.is_breaking ? 'rgba(255,34,68,0.08)' : 'rgba(30,45,64,0.4)')}
      onMouseLeave={e => (e.currentTarget.style.background = item.is_breaking ? 'rgba(255,34,68,0.04)' : 'transparent')}
    >
      {/* Top row */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        {item.is_breaking && (
          <span style={{ background: '#ff224422', color: '#ff2244', border: '1px solid #ff224444', padding: '0 4px', fontSize: 9, borderRadius: 2, fontWeight: 700 }}>
            ● 突发
          </span>
        )}
        <span style={{ color: tierColor, fontSize: 9, fontWeight: 600 }}>
          {item.source}
        </span>
        {item.category && (
          <span style={{ background: catColor + '22', color: catColor, border: `1px solid ${catColor}44`, padding: '0 4px', fontSize: 9, borderRadius: 2 }}>
            {CATEGORY_LABELS[item.category] || item.category}
          </span>
        )}
        {item.confidence && (
          <span style={{ color: '#334455', fontSize: 9, marginLeft: 'auto' }}>
            可信 {Math.round(item.confidence * 100)}%
          </span>
        )}
      </div>

      {/* Tags row */}
      {tags.length > 0 && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 4, flexWrap: 'wrap' }}>
          {tags.map((tag, i) => (
            <span key={i} style={{
              background: 'rgba(0, 212, 255, 0.1)', color: '#00d4ff',
              border: '1px solid rgba(0, 212, 255, 0.3)',
              padding: '1px 5px', fontSize: 9, borderRadius: 3, fontWeight: 600,
              boxShadow: '0 0 4px rgba(0, 212, 255, 0.15)'
            }}>
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* 中文内容主体：优先显示 AI 摘要，无摘要时 fallback 至原标题 */}
      <div style={{ fontSize: 11, lineHeight: 1.6, color: '#c9d1d9', marginBottom: 3 }}>
        {displaySummary}
      </div>

      {/* Expanded content */}
      {expanded && item.image_analysis && (
        <div style={{ marginTop: 6, padding: '6px 8px', background: '#0a0e14', borderRadius: 3, border: '1px solid #1e2d40' }}>
          <div style={{ fontSize: 9, color: '#00d4ff', marginBottom: 4 }}>🖼 图像分析 (AI)</div>
          <div style={{ fontSize: 10, color: '#8b9ab0', lineHeight: 1.5 }}>{item.image_analysis}</div>
        </div>
      )}

      {/* Bottom row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        {item.published_at && (
          <span style={{ fontSize: 9, color: '#334455' }}>
            {formatDistanceToNow(new Date(item.published_at), { locale: zhCN, addSuffix: true })}
          </span>
        )}
        <a href={item.url} target="_blank" rel="noreferrer"
          onClick={e => e.stopPropagation()}
          style={{ fontSize: 9, color: '#1a6fb5', textDecoration: 'none' }}>
          原文 →
        </a>
      </div>
    </div>
  );
}
