import { useEffect, useRef, useState } from 'react';
import { useAppStore, pushNotification } from './store/useAppStore';
import { useWebSocket } from './hooks/useWebSocket';
import { fetchOllamaHealth, fetchLatestReport, fetchTimelineRange, fetchLatestFinance } from './api/client';
import type { WsMessage, AnalysisReport } from './api/types';

import Header from './components/UI/Header';
import SidePanel from './components/UI/SidePanel';
import WarfareMap from './components/Map/WarfareMap';
import NewsPanel from './components/News/NewsPanel';
import AnalysisPanel from './components/Analysis/AnalysisPanel';
import ControlPanel from './components/Control/ControlPanel';
import Timeline from './components/Timeline/Timeline';
import KnowledgeGraphView from './components/Map/KnowledgeGraphView';

export type RefreshPhase = 'idle' | 'scraping' | 'analyzing' | 'reporting';
export type ViewMode = 'map' | 'graph';

export default function App() {
  const store = useAppStore();
  const [ollamaOk, setOllamaOk] = useState(false);
  const [llmProvider, setLlmProvider] = useState<string | undefined>(undefined);
  const [newsBadge, setNewsBadge] = useState(0);
  const [refreshPhase, setRefreshPhase] = useState<RefreshPhase>('idle');
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [financeData, setFinanceData] = useState<Record<string, { symbol: string; price: number; change: number }> | null>(null);
  const [headerRefreshKey, setHeaderRefreshKey] = useState(0);
  const autoRefreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // 新增视图模式状态
  const [viewMode, setViewMode] = useState<ViewMode>('map');

  // Check Ollama health + initial report fetch + dynamic timeline range
  useEffect(() => {
    fetchOllamaHealth()
      .then((r) => {
        setOllamaOk(r.status === 'ok');
        setLlmProvider(r.provider);
      })
      .catch(() => {
        setOllamaOk(false);
        setLlmProvider(undefined);
      });
    fetchLatestReport().then(r => { if ('id' in r) setReport(r as AnalysisReport); }).catch(() => { });
    fetchLatestFinance().then(setFinanceData).catch(() => { });

    // Phase 4: Dynamic timeline range initialization
    fetchTimelineRange().then(range => {
      store.setTimeline(prev => ({
        ...prev,
        startDate: new Date(range.start),
        endDate: new Date(range.end),
        currentDate: new Date(range.end), // Default to live view
      }));
    }).catch(err => console.error('Failed to fetch timeline range:', err));

    // 每 10 秒更新一次 endDate（时间轴右边界），确保“现在”时刻实时平移
    const endDateTimer = setInterval(() => {
      store.setTimeline(prev => {
        const now = new Date();
        
        // 如果当前预览时间 (currentDate) 就在 endDate 附近（5分钟内），
        // 或者之前就是对齐实时的，则让 currentDate 跟随 endDate 同步前进，实现 Live 效果
        const isLive = (prev.endDate.getTime() - prev.currentDate.getTime()) < 5 * 60 * 1000;
        
        return {
          ...prev,
          endDate: now,
          ...(isLive ? { currentDate: now } : {})
        };
      });
    }, 10 * 1000);
    return () => clearInterval(endDateTimer);
  }, []);

  // WebSocket
  useWebSocket((msg: WsMessage) => {
    if (msg.type === 'new_articles') {
      const text = `[${msg.source}] 新增 ${msg.count} 条新闻`;
      pushNotification(text);
      setNewsBadge(b => b + msg.count);
      setHeaderRefreshKey(k => k + 1);
    } else if (msg.type === 'new_events') {
      const text = `确认 ${msg.count} 起新安全事件`;
      pushNotification(text);
      setHeaderRefreshKey(k => k + 1);
    } else if (msg.type === 'new_report') {
      pushNotification(`最新 AI 态势推演已生成`);
      fetchLatestReport().then(r => { if ('id' in r) setReport(r as AnalysisReport); }).catch(() => { });
    } else if (msg.type === 'finance_update') {
      setFinanceData(msg.data);
    }
    
    // Auto-advance refresh phase state machine
    if (msg.type === 'phase_start') {
       if (msg.phase === 'analyze') setRefreshPhase('analyzing');
    } else if (msg.type === 'job_done') {
       setRefreshPhase('idle');
    }
  });

  // Auto-refresh loop
  useEffect(() => {
    if (store.autoRefresh) {
      autoRefreshTimerRef.current = setInterval(() => {
        setRefreshPhase('scraping');
        // Let the WebSocket events drive the rest of the phases
      }, store.refreshInterval * 60 * 1000);
    } else {
      if (autoRefreshTimerRef.current) clearInterval(autoRefreshTimerRef.current);
    }
    return () => { if (autoRefreshTimerRef.current) clearInterval(autoRefreshTimerRef.current); };
  }, [store.autoRefresh, store.refreshInterval]);

  const handleTabChange = (id: string) => {
    store.setActivePanel(id as 'news' | 'analysis' | 'control');
    if (id === 'news') setNewsBadge(0);
  };

  const tabs = [
    { id: 'news', label: '实时军情', icon: '📡', badge: newsBadge },
    { id: 'analysis', label: '深度研判', icon: '🧠' },
    { id: 'control', label: '控制中枢', icon: '⚙' }
  ];

  const timelineFrom = store.timeline.enabled ? store.timeline.startDate : null;
  const timelineTo = store.timeline.enabled ? store.timeline.currentDate : null;
  /** 近实时锚点：导图按 5 分钟桶拉取，避免每 10s Live  tick 导致力导图抖动 */
  const graphTimelineLive =
    store.timeline.enabled &&
    store.timeline.endDate.getTime() - store.timeline.currentDate.getTime() < 5 * 60 * 1000;

  return (
    <div className="scanline" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Header
        ollamaOk={ollamaOk}
        llmProvider={llmProvider}
        autoRefresh={store.autoRefresh}
        notifications={store.notifications}
        onToggleTimeline={() => store.setTimeline(t => ({ ...t, enabled: !t.enabled }))}
        timelineActive={store.timeline.enabled}
        refreshTrigger={headerRefreshKey}
        viewMode={viewMode}
        onViewModeChange={(mode) => {
          setViewMode(mode);
          if (mode === 'graph') {
            store.setTimeline(t => ({ ...t, enabled: true }));
          }
        }}
      />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        {/* Main View Area */}
        <div style={{ flex: 1, position: 'relative' }}>
          
          {viewMode === 'map' ? (
            <WarfareMap
              layers={store.layers}
              onToggleLayer={store.toggleLayer}
              timelineFrom={timelineFrom}
              timelineTo={timelineTo}
              timelineActive={store.timeline.enabled}
              onEventSelect={store.setSelectedEvent}
              hotspots={report?.hotspots ?? []}
              aiIntensityScore={report?.intensity_score ?? null}
              abuDhabiRisk={report?.abu_dhabi_risk ?? null}
            />
          ) : (
            <KnowledgeGraphView timelineTo={timelineTo} timelineLive={graphTimelineLive} />
          )}

          {/* Timeline overlaid at bottom of view area */}
          <Timeline
            timeline={store.timeline}
            onChange={(partial) => store.setTimeline(t => ({ ...t, ...partial }))}
          />
        </div>

        {/* Right side panel */}
        <SidePanel tabs={tabs} activeTab={store.activePanel} onTabChange={handleTabChange}>
          {store.activePanel === 'news' && (
            <NewsPanel onNewsSelect={store.setSelectedNews} />
          )}
          {store.activePanel === 'analysis' && (
            <AnalysisPanel report={report} financeData={financeData} />
          )}
          {store.activePanel === 'control' && (
            <ControlPanel
              autoRefresh={store.autoRefresh}
              onAutoRefreshChange={store.setAutoRefresh}
              refreshInterval={store.refreshInterval}
              onIntervalChange={store.setRefreshInterval}
              refreshPhase={refreshPhase}
              onRefreshStart={() => setRefreshPhase('scraping')}
            />
          )}
        </SidePanel>
      </div>
    </div>
  );
}
