import { useEffect, useRef, useState } from 'react';
import { useAppStore, pushNotification } from './store/useAppStore';
import { useWebSocket } from './hooks/useWebSocket';
import { fetchOllamaHealth, fetchLatestReport, fetchTimelineRange } from './api/client';
import type { WsMessage, AnalysisReport } from './api/types';

import Header from './components/UI/Header';
import SidePanel from './components/UI/SidePanel';
import WarfareMap from './components/Map/WarfareMap';
import NewsPanel from './components/News/NewsPanel';
import AnalysisPanel from './components/Analysis/AnalysisPanel';
import ControlPanel from './components/Control/ControlPanel';
import Timeline from './components/Timeline/Timeline';

export type RefreshPhase = 'idle' | 'scraping' | 'analyzing' | 'reporting';

export default function App() {
  const store = useAppStore();
  const [ollamaOk, setOllamaOk] = useState(false);
  const [newsBadge, setNewsBadge] = useState(0);
  const [refreshPhase, setRefreshPhase] = useState<RefreshPhase>('idle');
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [financeData, setFinanceData] = useState<Record<string, { symbol: string; price: number; change: number }> | null>(null);
  const [headerRefreshKey, setHeaderRefreshKey] = useState(0);
  const autoRefreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check Ollama health + initial report fetch + dynamic timeline range
  useEffect(() => {
    fetchOllamaHealth().then(r => setOllamaOk(r.status === 'ok')).catch(() => setOllamaOk(false));
    fetchLatestReport().then(r => { if ('id' in r) setReport(r as AnalysisReport); }).catch(() => { });

    // Phase 4: Dynamic timeline range initialization
    fetchTimelineRange().then(range => {
      store.setTimeline(prev => ({
        ...prev,
        startDate: new Date(range.start),
        endDate: new Date(range.end),
        currentDate: new Date(range.end), // Default to live view
      }));
    }).catch(err => console.error('Failed to fetch timeline range:', err));
  }, []);

  // WebSocket
  useWebSocket((msg: WsMessage) => {
    if (msg.type === 'new_articles') {
      const text = `[${msg.source}] 新增 ${msg.count} 条新闻`;
      pushNotification(text);
      setNewsBadge(b => b + msg.count);
      // If manual refresh is running, new_articles means scraping is progressing
      setRefreshPhase(p => p === 'scraping' ? 'scraping' : p);
    } else if (msg.type === 'ai_processed') {
      pushNotification(`AI 已处理 ${msg.count} 条新闻`);
      // Advance phase: scraping done → now generating report
      setRefreshPhase(p => p === 'scraping' || p === 'analyzing' ? 'reporting' : p);
      const refresh = (window as unknown as Record<string, unknown>).__warfareMapRefresh;
      if (typeof refresh === 'function') refresh();
    } else if (msg.type === 'analysis_updated') {
      pushNotification(`AI 分析报告已更新，烈度指数: ${msg.intensity_score}`);
      fetchLatestReport().then(r => { if ('id' in r) setReport(r as AnalysisReport); }).catch(() => { });
    } else if (msg.type === 'manual_refresh_done') {
      const label = msg.analysis_updated
        ? `手动刷新完成，AI 处理 ${msg.ai_processed} 条，报告已更新`
        : `手动刷新完成，AI 处理 ${msg.ai_processed} 条`;
      pushNotification(label);
      setRefreshPhase('idle');
      // Immediately re-fetch the header's "last update" timestamp
      setHeaderRefreshKey(k => k + 1);
    } else if (msg.type === 'finance_update') {
      setFinanceData(msg.data);
    }
  });

  // Auto-refresh map timer
  useEffect(() => {
    if (!store.autoRefresh) {
      if (autoRefreshTimerRef.current) clearInterval(autoRefreshTimerRef.current);
      return;
    }
    autoRefreshTimerRef.current = setInterval(() => {
      const refresh = (window as unknown as Record<string, unknown>).__warfareMapRefresh;
      if (typeof refresh === 'function') refresh();
    }, store.refreshInterval * 60 * 1000);
    return () => {
      if (autoRefreshTimerRef.current) clearInterval(autoRefreshTimerRef.current);
    };
  }, [store.autoRefresh, store.refreshInterval]);

  const handleTabChange = (id: string) => {
    store.setActivePanel(id as 'news' | 'analysis' | 'control');
    if (id === 'news') setNewsBadge(0);
  };

  const tabs = [
    { id: 'news', label: '情报', icon: '📡', badge: newsBadge },
    { id: 'analysis', label: '分析', icon: '🧠' },
    { id: 'control', label: '系统', icon: '⚙' },
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
      />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        {/* Main Map area */}
        <div style={{ flex: 1, position: 'relative' }}>
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
          {/* Timeline overlaid at bottom of map area */}
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
