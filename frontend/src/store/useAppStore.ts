import { useState, useEffect } from 'react';
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

// --- SINGLETON STATE ENGINE ---
// We move all state to module scope so it's consistent across all hook instances.
interface GlobalState {
  layers: LayerVisibility;
  autoRefresh: boolean;
  refreshInterval: number;
  selectedEvent: MilitaryEvent | null;
  selectedNews: NewsItem | null;
  activePanel: 'news' | 'analysis' | 'control';
  timeline: TimelineState;
  notifications: string[];
}

let _state: GlobalState = {
  layers: defaultLayers,
  autoRefresh: true,
  refreshInterval: 60,
  selectedEvent: null,
  selectedNews: null,
  activePanel: 'news',
  timeline: {
    enabled: true,
    startDate: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000),
    endDate: new Date(),
    currentDate: new Date(),
    playing: false,
    speedMultiplier: 1,
  },
  notifications: [],
};

const _listeners = new Set<() => void>();

function _notify() {
  _listeners.forEach(l => l());
}

export function pushNotification(msg: string) {
  _state.notifications = [msg, ..._state.notifications.slice(0, 9)];
  _notify();
}

export function useAppStore() {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const update = () => forceUpdate(n => n + 1);
    _listeners.add(update);
    return () => { _listeners.delete(update); };
  }, []);

  const setTimeline = (val: Partial<TimelineState> | ((prev: TimelineState) => TimelineState)) => {
    const next = typeof val === 'function' ? val(_state.timeline) : { ..._state.timeline, ...val };
    _state.timeline = next as TimelineState;
    _notify();
  };

  return {
    layers: _state.layers,
    toggleLayer: (key: keyof LayerVisibility) => {
      _state.layers = { ..._state.layers, [key]: !_state.layers[key] };
      _notify();
    },
    
    autoRefresh: _state.autoRefresh,
    setAutoRefresh: (val: boolean) => { _state.autoRefresh = val; _notify(); },
    
    refreshInterval: _state.refreshInterval,
    setRefreshInterval: (val: number) => { _state.refreshInterval = val; _notify(); },
    
    selectedEvent: _state.selectedEvent,
    setSelectedEvent: (val: MilitaryEvent | null) => { _state.selectedEvent = val; _notify(); },
    
    selectedNews: _state.selectedNews,
    setSelectedNews: (val: NewsItem | null) => { _state.selectedNews = val; _notify(); },
    
    activePanel: _state.activePanel,
    setActivePanel: (val: 'news' | 'analysis' | 'control') => { _state.activePanel = val; _notify(); },
    
    timeline: _state.timeline,
    setTimeline,
    
    notifications: _state.notifications,
  };
}
