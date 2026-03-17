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
    fetchOllamaHealth().then(r => setOllamaOk(r.status === 'ok')).catch(() => setOllamaOk(false));
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

    // 每 5 分钟更新 endDate，确保新事件进入时间轴范围
    const endDateTimer = setInterval(() => {
      store.setTimeline(prev => ({
        ...prev,
        endDate: new Date(),
        // 如果当前位于末尾，也跟随更新 currentDate
        ...(prev.currentDate >= prev.endDate ? { currentDate: new Date() } : {}),
      }));
    }, 5 * 60 * 1000);
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

  return (
    <div className="scanline" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Header
        ollamaOk={ollamaOk}
        autoRefresh={store.autoRefresh}
        notifications={store.notifications}
        onToggleTimeline={() => store.setTimeline(t => ({ ...t, enabled: !t.enabled }))}
        timelineActive={store.timeline.enabled}
        refreshTrigger={headerRefreshKey}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
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
            <KnowledgeGraphView timelineTo={timelineTo} />
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
