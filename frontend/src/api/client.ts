import axios from 'axios';
import type {
  NewsListResponse, MilitaryEvent, MilitaryUnit, ControlZone,
  GeoJsonFeatureCollection, AnalysisReport, IntensityTrend,
  ScraperSource, SystemStatus, LiveFlightsResponse, LiveShipsResponse,
} from './types';

const BASE = '';

const http = axios.create({ baseURL: BASE, timeout: 120000 });
/** OSINT 研判可能超过 120s，独立长超时（默认 300s） */
const osintHttp = axios.create({ baseURL: BASE, timeout: 300000 });

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

export type TimelineDensityDay = {
  date: string;
  news_count: number;
  event_count: number;
  event_severity_sum: number;
  news_fetched_fallback?: number;
};
export type TimelineDensityMeta = {
  requested_since?: string;
  requested_until?: string;
  effective_since_date?: string;
  effective_until_date?: string;
  calendar_span_days?: number;
  matched_day_count?: number;
  total_news_rows?: number;
  total_event_rows?: number;
  total_news_fetched_fallback?: number;
  timezone_basis?: string;
  window_signature?: string;
  window_signature_plain?: string;
  sum_news_count_days?: number;
  sum_event_count_days?: number;
  sums_consistent?: boolean;
  error?: string;
};
export const fetchTimelineDensity = (
  params: { since: string; until: string },
  signal?: AbortSignal
) =>
  http
    .get<{ days: TimelineDensityDay[]; meta?: TimelineDensityMeta }>('/api/timeline/density', {
      params,
      signal,
    })
    .then((r) => r.data);

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

export type OllamaHealthResponse = {
  status: string;
  model: string;
  /** lm_studio | ollama when online */
  provider?: string;
};
export const fetchOllamaHealth = () =>
  http.get<OllamaHealthResponse>('/api/analysis/ollama/health').then((r) => r.data);

export type OsintCitation = { id: number; type: string; time: string; title: string };
export type OsintChatMeta = {
  model: string;
  latency_ms: number;
  context_counts: { news: number; events: number; finance: number };
  fallback_reason?: string | null;
  parse_mode?: string | null;
  request_id: string;
};
export type OsintChatResult = {
  reply: string;
  status: string;
  answer: string;
  core_assessment: string;
  analysis: string;
  citations: OsintCitation[];
  meta: OsintChatMeta;
};

export const queryOsintChat = (message: string, lookbackDays = 7) =>
  osintHttp
    .post<OsintChatResult>('/api/chat/query', {
      message,
      lookback_days: Math.min(30, Math.max(1, Math.round(lookbackDays))),
    })
    .then(r => r.data);

export type KnowledgeGraphMeta = {
  window_start: string;
  window_end: string;
  data_coverage_start: string;
  data_coverage_end: string;
  report_total?: number;
  report_valid?: number;
  report_filtered_failed?: number;
};

export const fetchKnowledgeGraph = (
  days: number = 7,
  interpretation: boolean = true,
  includeFailedReports: boolean = false,
  until?: Date | null,
  signal?: AbortSignal
) => {
  const params: Record<string, string | number | boolean> = {
    days: Math.max(1, Math.min(365, Math.round(days))),
    interpretation: Boolean(interpretation),
    include_failed_reports: Boolean(includeFailedReports),
  };
  if (until) params.until = until.toISOString();
  return http
    .get<{ nodes: any[]; links: any[]; meta?: KnowledgeGraphMeta }>('/api/graph/knowledge', {
      params,
      signal,
    })
    .then(r => r.data);
};

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
