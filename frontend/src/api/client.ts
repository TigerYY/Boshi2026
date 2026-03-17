import axios from 'axios';
import type {
  NewsListResponse, MilitaryEvent, MilitaryUnit, ControlZone,
  GeoJsonFeatureCollection, AnalysisReport, IntensityTrend,
  ScraperSource, SystemStatus, LiveFlightsResponse, LiveShipsResponse,
} from './types';

const BASE = '';

const http = axios.create({ baseURL: BASE, timeout: 120000 });

// ── News ──────────────────────────────────────────────────────────────────
export const fetchNews = (params?: {
  page?: number; size?: number; category?: string;
  source_tier?: number; breaking_only?: boolean;
  since?: string; until?: string; q?: string;
}) => http.get<NewsListResponse>('/api/news', { params }).then(r => r.data);

// ── Events ────────────────────────────────────────────────────────────────
export const fetchEvents = (params?: {
  event_type?: string; side?: string; since?: string;
  until?: string; confirmed_only?: boolean; min_severity?: number;
}) => http.get<MilitaryEvent[]>('/api/events', { params }).then(r => r.data);

export const fetchTimelineRange = () =>
  http.get<{ start: string; end: string; first_event: string }>('/api/events/range').then(r => r.data);

export const fetchEventsGeoJson = (params?: { since?: string; until?: string }) =>
  http.get<GeoJsonFeatureCollection>('/api/events/geojson', { params }).then(r => r.data);

// ── Units ─────────────────────────────────────────────────────────────────
export const fetchUnits = (params?: { side?: string; unit_type?: string }) =>
  http.get<MilitaryUnit[]>('/api/units', { params }).then(r => r.data);

export const fetchUnitsGeoJson = () =>
  http.get<GeoJsonFeatureCollection>('/api/units/geojson').then(r => r.data);

// ── Zones ─────────────────────────────────────────────────────────────────
export const fetchZones = (params?: { zone_type?: string; side?: string }) =>
  http.get<ControlZone[]>('/api/zones', { params }).then(r => r.data);

export const fetchZonesGeoJson = () =>
  http.get<GeoJsonFeatureCollection>('/api/zones/geojson').then(r => r.data);

// ── Analysis ──────────────────────────────────────────────────────────────
export const fetchLatestReport = (type = 'daily_summary') =>
  http.get<AnalysisReport>('/api/analysis/latest', { params: { report_type: type } }).then(r => r.data);

export const fetchIntensityTrend = (days = 7) =>
  http.get<IntensityTrend>('/api/analysis/intensity', { params: { days } }).then(r => r.data);

export const triggerAnalysis = () =>
  http.post('/api/analysis/generate').then(r => r.data);

export const fetchLatestFinance = () =>
  http.get<Record<string, { symbol: string; price: number; change: number }>>('/api/analysis/finance').then(r => r.data);

export const fetchOllamaHealth = () =>
  http.get<{ status: string; model: string }>('/api/analysis/ollama/health').then(r => r.data);

export const queryOsintChat = (message: string) =>
  http.post<{ reply: string; status: string }>('/api/chat/query', { message }).then(r => r.data);

export const fetchKnowledgeGraph = (days = 7) =>
  http.get<{ nodes: any[]; links: any[] }>('/api/graph/knowledge', { params: { days } }).then(r => r.data);

// ── Control ───────────────────────────────────────────────────────────────
export const fetchSources = () =>
  http.get<ScraperSource[]>('/api/control/sources').then(r => r.data);

export const updateSource = (source_id: string, data: { enabled?: boolean; auto_interval_minutes?: number }) =>
  http.patch<ScraperSource>(`/api/control/sources/${source_id}`, data).then(r => r.data);

export const triggerRefresh = (source_id?: string) =>
  http.post('/api/control/refresh', null, { params: source_id ? { source_id } : {} }).then(r => r.data);

export const fetchSystemStatus = () =>
  http.get<SystemStatus>('/api/control/status').then(r => r.data);

// ── Live tracking ─────────────────────────────────────────────────────────
export const fetchLiveFlights = () =>
  http.get<LiveFlightsResponse>('/api/flights/live').then(r => r.data);

export const fetchHistoryFlights = (timestamp: string) =>
  http.get<LiveFlightsResponse>('/api/flights/history', { params: { timestamp } }).then(r => r.data);

export const fetchLiveShips = () =>
  http.get<LiveShipsResponse>('/api/ships/live').then(r => r.data);

export const fetchHistoryShips = (timestamp: string) =>
  http.get<LiveShipsResponse>('/api/ships/history', { params: { timestamp } }).then(r => r.data);
