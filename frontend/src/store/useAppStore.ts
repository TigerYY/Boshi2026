import { useState, useCallback, useRef } from 'react';
import type { MilitaryEvent, NewsItem } from '../api/types';

export interface LayerVisibility {
  us_units: boolean;
  iran_units: boolean;
  proxy_units: boolean;
  events: boolean;
  control_zones: boolean;
  heatmap: boolean;
  aircraft: boolean;
  ships: boolean;
  video_feeds: boolean;
}

export interface TimelineState {
  enabled: boolean;
  startDate: Date;
  endDate: Date;
  currentDate: Date;
  playing: boolean;
  speedMultiplier: number;
}

const defaultLayers: LayerVisibility = {
  us_units: true,
  iran_units: true,
  proxy_units: true,
  events: true,
  control_zones: true,
  heatmap: false,
  aircraft: true,
  ships: true,
  video_feeds: true,
};

// Simple global state using module-level variables + React state hooks
// (In a larger app would use Zustand/Redux; this is sufficient here)

let _globalNotifications: string[] = [];
let _globalListeners: Array<() => void> = [];

export function pushNotification(msg: string) {
  _globalNotifications = [msg, ..._globalNotifications.slice(0, 9)];
  _globalListeners.forEach(l => l());
}

export function useAppStore() {
  const [layers, setLayers] = useState<LayerVisibility>(defaultLayers);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(60);
  const [selectedEvent, setSelectedEvent] = useState<MilitaryEvent | null>(null);
  const [selectedNews, setSelectedNews] = useState<NewsItem | null>(null);
  const [activePanel, setActivePanel] = useState<'news' | 'analysis' | 'control'>('news');
  const [, forceUpdate] = useState(0);
  const [timeline, setTimeline] = useState<TimelineState>({
    enabled: true,
    startDate: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000), // 45 days ago
    endDate: new Date(),
    currentDate: new Date(),
    playing: false,
    speedMultiplier: 1,
  });

  // Register for notification updates
  const listenerRef = useRef<(() => void) | null>(null);
  if (!listenerRef.current) {
    listenerRef.current = () => forceUpdate(n => n + 1);
    _globalListeners.push(listenerRef.current);
  }

  const toggleLayer = useCallback((key: keyof LayerVisibility) => {
    setLayers(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const notifications = _globalNotifications;

  return {
    layers, toggleLayer,
    autoRefresh, setAutoRefresh,
    refreshInterval, setRefreshInterval,
    selectedEvent, setSelectedEvent,
    selectedNews, setSelectedNews,
    activePanel, setActivePanel,
    timeline, setTimeline,
    notifications,
  };
}
