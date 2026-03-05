export interface Location {
  name: string;
  lat: number;
  lon: number;
}

export interface NewsItem {
  id: number;
  source: string;
  source_tier: number;
  title: string;
  url: string;
  summary_zh: string | null;
  category: string | null;
  confidence: number | null;
  locations: Location[];
  image_url: string | null;
  image_analysis: string | null;
  is_breaking: boolean;
  published_at: string | null;
  fetched_at: string | null;
  processed: boolean;
}

export interface NewsListResponse {
  total: number;
  page: number;
  size: number;
  items: NewsItem[];
}

export interface MilitaryEvent {
  id: number;
  event_type: string;
  title: string;
  description: string | null;
  lat: number | null;
  lon: number | null;
  location_name: string | null;
  occurred_at: string;
  side: string | null;
  confirmed: boolean;
  severity: number;
  casualties: Record<string, unknown> | null;
  source_news_id: number | null;
}

export interface MilitaryUnit {
  id: number;
  name: string;
  unit_type: string;
  side: string;
  lat: number;
  lon: number;
  location_name: string;
  status: string;
  updated_at: string | null;
  extra: Record<string, unknown>;
}

export interface ControlZone {
  id: number;
  name: string;
  zone_type: string;
  side: string;
  valid_from: string | null;
  valid_to: string | null;
}

export interface GeoJsonFeatureCollection {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: { type: string; coordinates: unknown };
    properties: Record<string, unknown>;
  }>;
}

export interface AnalysisReport {
  id: number;
  report_type: string;
  content: string;
  generated_at: string | null;
  period_start: string | null;
  period_end: string | null;
  intensity_score: number;
  hotspots: Array<{ name: string; lat: number; lon: number; score: number; reason: string }>;
  key_developments: string[];
  outlook: string;
  escalation_probability?: number;
  market_correlation?: string;
}

export interface IntensityTrend {
  daily_intensity: Array<{ date: string; score: number }>;
  event_type_dist: Array<{ type: string; count: number }>;
}

export interface ScraperSource {
  source_id: string;
  source_name: string;
  enabled: boolean;
  last_run: string | null;
  last_success: string | null;
  last_count: number;
  error_msg: string | null;
  auto_interval_minutes: number;
}

export interface SystemStatus {
  news_total: number;
  events_total: number;
  news_unprocessed: number;
  timestamp: string;
}

export interface Aircraft {
  icao24: string;
  callsign: string;
  origin_country: string;
  lon: number;
  lat: number;
  altitude: number;
  on_ground: boolean;
  velocity: number;
  heading: number;
}

export interface LiveFlightsResponse {
  aircraft: Aircraft[];
  cached: boolean;
  count: number;
}

export interface Ship {
  mmsi: string;
  name: string;
  ship_type: string;
  flag: string;
  lat: number;
  lon: number;
  speed: number;
  heading: number;
  status: string;
  side: 'US' | 'IR' | 'civilian';
}

export interface LiveShipsResponse {
  ships: Ship[];
  cached: boolean;
  count: number;
  demo: boolean;
}

export type WsMessage =
  | { type: 'new_articles'; source: string; count: number; timestamp: string }
  | { type: 'ai_processed'; count: number; timestamp: string }
  | { type: 'analysis_updated'; report_type: string; intensity_score: number; timestamp: string }
  | { type: 'manual_refresh_done'; ai_processed: number; analysis_updated?: boolean; timestamp: string }
  | { type: 'finance_update'; data: { symbol: string; price: number; change: number }; timestamp: string }
  | { type: 'pong' };
