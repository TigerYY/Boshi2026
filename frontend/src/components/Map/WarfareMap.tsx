import { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.heat';
import { renderToStaticMarkup } from 'react-dom/server';
import { useAppStore } from '../../store/useAppStore';
import type { LayerVisibility } from '../../store/useAppStore';
import type { MilitaryEvent, MilitaryUnit, GeoJsonFeatureCollection } from '../../api/types';
import { fetchEventsGeoJson, fetchUnitsGeoJson, fetchZonesGeoJson, fetchLiveFlights, fetchLiveShips } from '../../api/client';
import { getEventIcon, getUnitIcon } from './mapIcons';
import EventPopup from './EventPopup';
import UnitPopup from './UnitPopup';
import LayerControl from './LayerControl';
import IntensityOverlay from './IntensityOverlay';

interface Hotspot {
  name: string;
  lat: number;
  lon: number;
  score: number;
  reason: string;
}

const CHANNELS = {
  aljazeera: {
    label: 'Al Jazeera',
    channelId: 'UCNye-wNBqNL5ZzHSJj3l8Bg',
    uploadsPlaylist: 'UUNye-wNBqNL5ZzHSJj3l8Bg',
    url: 'https://www.youtube.com/@AlJazeeraEnglish/videos',
    color: '#ff6b35',
  },
  iranintl: {
    label: 'Iran Intl Live',
    channelId: 'UCyDoic6SdHXTN0mWPub_nOg',
    uploadsPlaylist: 'UUyDoic6SdHXTN0mWPub_nOg',
    url: 'https://www.youtube.com/channel/UCyDoic6SdHXTN0mWPub_nOg/videos',
    color: '#ff4444',
  },
  milsum: {
    label: 'Mil. Summary',
    channelId: 'UCUnc496-PPmFZVKlYxUnToA',
    uploadsPlaylist: 'UUUnc496-PPmFZVKlYxUnToA',
    url: 'https://www.youtube.com/channel/UCUnc496-PPmFZVKlYxUnToA/videos',
    color: '#00ff88',
  },
  bbc: {
    label: 'BBC News',
    channelId: 'UC16niRr50-MSBwiO3YDb3RA',
    uploadsPlaylist: 'UU16niRr50-MSBwiO3YDb3RA',
    url: 'https://www.youtube.com/@BBCNews/videos',
    color: '#1a6fb5',
  },
  sky: {
    label: 'Sky News',
    channelId: 'UCV3dzDCJ-W72KJMzBMkLrVg',
    uploadsPlaylist: 'UUV3dzDCJ-W72KJMzBMkLrVg',
    url: 'https://www.youtube.com/@SkyNews/videos',
    color: '#00d4ff',
  },
  wion: {
    label: 'WION',
    channelId: 'UCkePvEJa5MmzUhvz9pBe-tg',
    uploadsPlaylist: 'UUkePvEJa5MmzUhvz9pBe-tg',
    url: 'https://www.youtube.com/@WIONLive/videos',
    color: '#9c66ff',
  },
};

const VIDEO_HOTSPOTS = [
  {
    id: 'bahrain_base',
    name: '麦纳麦·美军第五舰队',
    lat: 26.22, lon: 50.59,
    description: '美国海军第五舰队总部，巴林麦纳麦港',
    searchQuery: 'US Fifth Fleet Bahrain navy 2025',
    channels: ['aljazeera', 'bbc', 'iranintl'],
    primaryChannel: 'aljazeera',
  },
  {
    id: 'strait_of_hormuz',
    name: '霍尔木兹海峡',
    lat: 26.58, lon: 56.45,
    description: '全球最重要石油运输通道，IRGC活动频繁',
    searchQuery: 'Strait of Hormuz Iran IRGC warship 2025',
    channels: ['iranintl', 'aljazeera', 'milsum'],
    primaryChannel: 'iranintl',
  },
  {
    id: 'tehran',
    name: '德黑兰',
    lat: 35.69, lon: 51.42,
    description: '伊朗首都，政治军事决策中枢',
    searchQuery: 'Tehran Iran military news 2025',
    channels: ['iranintl', 'aljazeera', 'bbc'],
    primaryChannel: 'iranintl',
  },
  {
    id: 'bandar_abbas',
    name: '班达尔阿巴斯·IRGC海军',
    lat: 27.19, lon: 56.27,
    description: '伊斯兰革命卫队海军主要基地',
    searchQuery: 'Bandar Abbas IRGC Iran navy 2025',
    channels: ['iranintl', 'milsum', 'wion'],
    primaryChannel: 'iranintl',
  },
  {
    id: 'al_udeid',
    name: '乌代德空军基地',
    lat: 25.12, lon: 51.31,
    description: '卡塔尔·美国空军前进基地，B-52/F-35部署地',
    searchQuery: 'Al Udeid Air Base USAF Qatar 2025',
    channels: ['aljazeera', 'bbc', 'milsum'],
    primaryChannel: 'aljazeera',
  },
  {
    id: 'natanz',
    name: '纳坦兹核设施',
    lat: 33.72, lon: 51.73,
    description: '伊朗主要铀浓缩设施，曾遭多次打击',
    searchQuery: 'Natanz Iran nuclear strike damage 2025',
    channels: ['iranintl', 'bbc', 'milsum'],
    primaryChannel: 'milsum',
  },
  {
    id: 'red_sea',
    name: '红海·胡塞武装区',
    lat: 15.0, lon: 43.0,
    description: '胡塞武装反舰导弹和无人机袭击商船水域',
    searchQuery: 'Houthi Red Sea ship attack drone 2025',
    channels: ['aljazeera', 'sky', 'milsum'],
    primaryChannel: 'milsum',
  },
  {
    id: 'fordow',
    name: '福尔多核设施',
    lat: 34.88, lon: 50.50,
    description: '地下铀浓缩设施，深埋山体，难以摧毁',
    searchQuery: 'Fordow Iran underground nuclear 2025',
    channels: ['iranintl', 'bbc', 'wion'],
    primaryChannel: 'iranintl',
  },
];

interface Props {
  layers: LayerVisibility;
  onToggleLayer: (key: keyof LayerVisibility) => void;
  timelineFrom?: Date | null;
  timelineTo?: Date | null;
  timelineActive?: boolean;
  onEventSelect?: (event: MilitaryEvent) => void;
  hotspots?: Hotspot[];
  aiIntensityScore?: number | null;
  abuDhabiRisk?: number | null;
}

const ZONE_COLORS: Record<string, string> = {
  patrol: '#1a6fb5', exclusion: '#cc2222', blockade: '#cc8800', control: '#9c66ff',
};

function createHotspotIcon(score: number, name: string, zoom: number): L.DivIcon {
  const color = score >= 7 ? '#ff2244' : score >= 4 ? '#ff6b35' : '#ffdd00';
  // 基础缩放因子：以 zoom 5 为基准，缩放时按指数级调整圆环大小
  const scale = Math.pow(1.5, zoom - 5);
  const r1 = Math.round(score * 22 * scale);
  const r2 = Math.round(score * 44 * scale);
  const r3 = Math.round(score * 66 * scale);
  const dur = (3.5 - score * 0.15).toFixed(1);
  return L.divIcon({
    className: '',
    html: `
      <div class="hotspot-marker" style="--hs-color:${color}; --hs-dur:${dur}s; width:20px; height:20px;">
        <div class="hotspot-core"></div>
        <div class="hotspot-ring" style="width:${r1 * 2}px;height:${r1 * 2}px;animation-delay:0s;"></div>
        <div class="hotspot-ring" style="width:${r2 * 2}px;height:${r2 * 2}px;animation-delay:1.1s;"></div>
        <div class="hotspot-ring" style="width:${r3 * 2}px;height:${r3 * 2}px;animation-delay:2.2s;"></div>
        <div class="hotspot-label" style="pointer-events: auto; transform: translateX(-50%) scale(${Math.max(0.7, Math.min(1.2, scale))});">${name}</div>
      </div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

function createAircraftIcon(heading: number, onGround: boolean, country: string): L.DivIcon {
  const isUs = country === 'United States';
  const isIr = country === 'Iran';
  const color = onGround ? '#334455' : isUs ? '#00d4ff' : isIr ? '#ff6b35' : '#aabbcc';
  const opacity = onGround ? 0.4 : 0.9;
  return L.divIcon({
    className: '',
    html: `<div class="aircraft-icon" style="--ac-color:${color}; --ac-heading:${heading}deg; opacity:${opacity};">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="${color}">
        <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
      </svg>
    </div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

function createShipIcon(heading: number, side: string, shipType: string): L.DivIcon {
  const color = side === 'US' ? '#00d4ff' : side === 'IR' ? '#ff4444' : '#88aa88';
  const isWarship = ['carrier', 'destroyer', 'cruiser', 'frigate', 'submarine', 'amphibious', 'patrol_vessel', 'warship'].includes(shipType);
  const w = isWarship ? 14 : 12;
  const h = isWarship ? 18 : 16;
  const shapePath = isWarship
    ? `<path d="M7 1 L10 7 L9 16 L5 16 L4 7 Z" fill="${color}" opacity="0.9"/>`
    : `<path d="M7 2 L11 5 L11 15 L3 15 L3 5 Z" fill="${color}" opacity="0.75"/>`;

  return L.divIcon({
    className: '',
    html: `<div class="ship-icon" style="--sh-color:${color}; --sh-heading:${heading}deg;">
      <svg viewBox="0 0 14 18" width="${w}" height="${h}">${shapePath}</svg>
    </div>`,
    iconSize: [w, h],
    iconAnchor: [w / 2, h / 2],
  });
}

function createVideoIcon(): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div class="video-hotspot-icon" title="点击查看实况视频">📹</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function toUploadsPlaylist(channelId: string): string {
  return channelId.startsWith('UC') ? 'UU' + channelId.slice(2) : channelId;
}

function buildVideoPopupHtml(hotspot: typeof VIDEO_HOTSPOTS[0]): string {
  const primaryCh = CHANNELS[hotspot.primaryChannel as keyof typeof CHANNELS];
  const primaryChannelId = primaryCh?.channelId ?? '';
  const playlistId = primaryCh ? toUploadsPlaylist(primaryCh.channelId) : '';
  const playlistSrc = playlistId
    ? `https://www.youtube.com/embed?list=${playlistId}&listType=playlist&rel=0&modestbranding=1`
    : '';
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(hotspot.searchQuery)}`;

  const channelButtons = hotspot.channels
    .map((key) => {
      const ch = CHANNELS[key as keyof typeof CHANNELS];
      if (!ch) return '';
      return `<a href="${ch.url}" target="_blank" rel="noreferrer"
        style="display:flex;align-items:center;gap:5px;padding:4px 8px;text-decoration:none;
               background:rgba(0,0,0,0.4);border:1px solid ${ch.color}33;border-radius:3px;
               font-size:10px;color:${ch.color};"
        onmouseover="this.style.background='${ch.color}22'"
        onmouseout="this.style.background='rgba(0,0,0,0.4)'">
        ▶ ${ch.label}
      </a>`;
    })
    .join('');

  const videoHtml = playlistSrc
    ? `<iframe src="${playlistSrc}" width="308" height="173" frameborder="0" allow="encrypted-media; picture-in-picture" allowfullscreen style="display:block;border:none;border-radius:3px;"></iframe>`
    : `<div style="height:173px;display:flex;align-items:center;justify-content:center;"><span style="font-size:9px;color:#4a6070;">暂无视频源</span></div>`;

  return `
    <div style="width:314px;font-family:'JetBrains Mono',monospace;background:rgba(8,12,18,0.97);border:1px solid #1e3a4a;border-radius:4px;padding:10px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
        <span style="font-size:12px;font-weight:700;color:#ff6b35;letter-spacing:0.5px;">📹 ${hotspot.name}</span>
        <span style="font-size:9px;color:#334a5a;border:1px solid #1e3040;padding:2px 5px;border-radius:2px;">${hotspot.lat.toFixed(2)}°N&nbsp;${hotspot.lon.toFixed(2)}°E</span>
      </div>
      <div style="font-size:10px;color:#7a9baa;margin-bottom:8px;line-height:1.5;padding:5px 8px;background:rgba(255,107,53,0.05);border-left:2px solid #ff6b3555;border-radius:0 2px 2px 0;">${hotspot.description}</div>
      <div id="yt-video-${hotspot.id}" data-channel-id="${primaryChannelId}" data-search="${encodeURIComponent(hotspot.searchQuery)}" style="margin-bottom:8px;border-radius:3px;overflow:hidden;border:1px solid #1e3a4a;">${videoHtml}</div>
      <div style="font-size:10px;color:#4a6070;margin-bottom:5px;text-transform:uppercase;letter-spacing:0.8px;">▌ OSINT 频道</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px;">${channelButtons}</div>
      <a href="${searchUrl}" target="_blank" rel="noreferrer" style="display:flex;align-items:center;justify-content:center;gap:6px;padding:6px 0;text-decoration:none;background:rgba(255,107,53,0.12);border:1px solid #ff6b3566;border-radius:3px;font-size:10px;color:#ff9055;letter-spacing:0.5px;" onmouseover="this.style.background='rgba(255,107,53,0.22)'" onmouseout="this.style.background='rgba(255,107,53,0.12)'">🔍&nbsp;YouTube 实时搜索 →</a>
    </div>`;
}

const POPUP_OPTS: L.PopupOptions = { autoClose: true, closeOnClick: true };

export default function WarfareMap({ layers, onToggleLayer, timelineFrom, timelineTo, timelineActive = false, onEventSelect, hotspots = [], aiIntensityScore, abuDhabiRisk = null }: Props) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const layersRef = useRef<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [currentZoom, setCurrentZoom] = useState(5);
  const { refreshInterval } = useAppStore();
  const [dataVersion, setDataVersion] = useState(0);

  const rawEventsRef = useRef<GeoJsonFeatureCollection | null>(null);
  const rawUnitsRef = useRef<GeoJsonFeatureCollection | null>(null);
  const rawZonesRef = useRef<GeoJsonFeatureCollection | null>(null);
  const eventMarkersRef = useRef<Array<{ marker: L.Marker, time: number }>>([]);

  const fetchRawData = useCallback(async () => {
    if (!mapRef.current) return;
    try {
      setLoading(true);
      const params: { since?: string } = {};
      if (timelineFrom) params.since = timelineFrom.toISOString();
      const [eventsGeo, unitsGeo, zonesGeo] = await Promise.all([fetchEventsGeoJson(params), fetchUnitsGeoJson(), fetchZonesGeoJson()]);
      rawEventsRef.current = eventsGeo;
      rawUnitsRef.current = unitsGeo;
      rawZonesRef.current = zonesGeo;
      setDataVersion(v => v + 1);
    } catch (err) {
      console.error('Map raw data fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [timelineFrom]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [28, 52],
      zoom: 5,
      minZoom: 3,
      maxZoom: 14,
      zoomControl: true,
      closePopupOnClick: true,
    });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/">CARTO</a>',
      maxZoom: 19,
    }).addTo(map);

    layersRef.current = {
      us_units: L.layerGroup().addTo(map),
      iran_units: L.layerGroup().addTo(map),
      proxy_units: L.layerGroup().addTo(map),
      events: L.layerGroup().addTo(map),
      control_zones: L.layerGroup().addTo(map),
      hotspots: L.layerGroup().addTo(map),
      aircraft: L.layerGroup().addTo(map),
      ships: L.layerGroup().addTo(map),
      video_feeds: L.layerGroup().addTo(map),
      heatmap_layer: (L as any).heatLayer([], {
        radius: 25, blur: 15, maxZoom: 10,
        gradient: { 0.4: '#00ff88', 0.65: '#ffdd00', 1: '#ff2244' }
      }).addTo(map),
    };

    for (const vh of VIDEO_HOTSPOTS) {
      const marker = L.marker([vh.lat, vh.lon], { icon: createVideoIcon(), zIndexOffset: 200 });
      marker.bindPopup(buildVideoPopupHtml(vh), { ...POPUP_OPTS, maxWidth: 340, className: 'video-popup' });
      layersRef.current.video_feeds.addLayer(marker);
    }

    map.on('popupopen', async (e: L.LeafletEvent) => {
      const popup = (e as L.PopupEvent).popup;
      const container = popup.getElement()?.querySelector('[data-channel-id]') as HTMLElement | null;
      if (!container) return;
      const channelId = container.getAttribute('data-channel-id');
      try {
        const res = await fetch(`/api/youtube/latest?channel_id=${channelId}`);
        const data = await res.json();
        if (data.videoId) {
          container.innerHTML = `<div style="font-size:9px;color:#4a6070;padding:3px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-bottom:1px solid #1e3040;background:rgba(0,0,0,0.4);">🎬 ${data.title ?? '最新视频'}</div><iframe src="https://www.youtube.com/embed/${data.videoId}?rel=0&modestbranding=1" width="308" height="160" frameborder="0" allow="encrypted-media; picture-in-picture" allowfullscreen style="display:block;border:none;"></iframe>`;
          popup.update();
        }
      } catch { }
    });

    map.on('zoomend', () => {
      setCurrentZoom(map.getZoom());
    });

    mapRef.current = map;
    fetchRawData();
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  const buildMapLayers = useCallback(() => {
    if (!mapRef.current) return;
    const { hotspots: hotspotsLg, control_zones: zonesLg, us_units: usLg, iran_units: irLg, proxy_units: prLg, events: evLg, heatmap_layer: hmLayer } = layersRef.current;

    hotspotsLg.clearLayers();
    if (layers.heatmap) {
      if (!mapRef.current.hasLayer(hmLayer)) hmLayer.addTo(mapRef.current);
      for (const h of hotspots) {
        const marker = L.marker([h.lat, h.lon], { icon: createHotspotIcon(h.score, h.name, currentZoom), zIndexOffset: 100, interactive: true });
        marker.bindPopup(`<div style="font-size:12px"><div style="font-weight:700;margin-bottom:4px;color:#ff6b35">${h.name}</div><div style="font-size:10px;color:#ff6b35;margin-bottom:4px">热度指数 ${h.score.toFixed(1)} / 10</div><div style="font-size:10px;color:#8b9ab0;line-height:1.5">${h.reason}</div></div>`, { ...POPUP_OPTS });
        hotspotsLg.addLayer(marker);
      }
      if (abuDhabiRisk !== null) {
        const color = abuDhabiRisk > 50 ? '#ff2244' : abuDhabiRisk > 30 ? '#ffdd00' : '#00ff88';
        const dur = abuDhabiRisk > 50 ? '1s' : '3s';
        const adIcon = L.divIcon({
          className: '',
          html: `<div style="position:relative; width:40px; height:40px; display:flex; align-items:center; justify-content:center;"><div style="position:absolute; width:100%; height:100%; border-radius:50%; background:${color}00; border:2px solid ${color}; animation: pulse ${dur} infinite;"></div><div style="position:absolute; width:60%; height:60%; border-radius:50%; background:${color}44; border:1px solid ${color}; display:flex; align-items:center; justify-content:center; font-size:10px; color:#fff; text-shadow:0 0 5px #000;">🇦🇪</div><div style="position:absolute; top:-25px; white-space:nowrap; background:rgba(0,0,0,0.8); border:1px solid ${color}; color:${color}; padding:2px 6px; border-radius:3px; font-size:9px; font-weight:bold; pointer-events:none;">阿布扎比区域雷达 (风险 ${abuDhabiRisk.toFixed(0)})</div></div>`,
          iconSize: [40, 40], iconAnchor: [20, 20],
        });
        const adMarker = L.marker([24.4539, 54.3773], { icon: adIcon, zIndexOffset: 150, interactive: false });
        hotspotsLg.addLayer(adMarker);
      }
    } else {
      if (mapRef.current.hasLayer(hmLayer)) mapRef.current.removeLayer(hmLayer);
    }

    evLg.clearLayers();
    eventMarkersRef.current = [];
    if (layers.events && rawEventsRef.current) {
      for (const f of rawEventsRef.current.features) {
        const e = f.properties as unknown as MilitaryEvent;
        const coords = f.geometry.coordinates as [number, number];
        const marker = L.marker([coords[1], coords[0]], { icon: getEventIcon(e.event_type) });
        marker.bindPopup(renderToStaticMarkup(<EventPopup event={e} />), { ...POPUP_OPTS, maxWidth: 300 });
        marker.on('click', () => onEventSelect?.(e));
        evLg.addLayer(marker);
        eventMarkersRef.current.push({ marker, time: new Date(e.occurred_at).getTime() });
      }
    }

    const unitLayers = [{ side: 'US', lg: usLg, key: 'us_units' }, { side: 'Iran', lg: irLg, key: 'iran_units' }, { side: 'proxy', lg: prLg, key: 'proxy_units' }];
    for (const { side, lg, key } of unitLayers) {
      lg.clearLayers();
      if (layers[key as keyof LayerVisibility] && rawUnitsRef.current) {
        for (const f of rawUnitsRef.current.features) {
          const u = f.properties as unknown as MilitaryUnit;
          if (u.side !== side) continue;
          const coords = f.geometry.coordinates as [number, number];
          const marker = L.marker([coords[1], coords[0]], { icon: getUnitIcon(u.unit_type, u.side) });
          marker.bindPopup(renderToStaticMarkup(<UnitPopup unit={u} />), { ...POPUP_OPTS, maxWidth: 280 });
          lg.addLayer(marker);
        }
      }
    }

    zonesLg.clearLayers();
    if (layers.control_zones && rawZonesRef.current) {
      for (const f of rawZonesRef.current.features) {
        const props = f.properties as any;
        const color = ZONE_COLORS[props.zone_type] || '#888';
        const geoLayer = L.geoJSON(f as any, { style: { color, weight: 1.5, opacity: 0.7, fillOpacity: 0.08, fillColor: color, dashArray: props.zone_type === 'exclusion' ? '8,4' : undefined } });
        geoLayer.bindPopup(`<div style="font-size:12px"><div style="font-weight:600;margin-bottom:4px">${props.name}</div><div style="font-size:10px;color:#8b9ab0">${props.zone_type.toUpperCase()} | ${props.side}</div></div>`, { ...POPUP_OPTS });
        zonesLg.addLayer(geoLayer);
      }
    }
  }, [layers, hotspots, abuDhabiRisk, onEventSelect, dataVersion, currentZoom]);

  useEffect(() => { buildMapLayers(); }, [buildMapLayers]);

  useEffect(() => {
    const tTo = timelineTo?.getTime() ?? Date.now();
    const t3d = tTo - 3 * 24 * 3600 * 1000;
    const t14d = tTo - 14 * 24 * 3600 * 1000;

    for (const { marker, time } of eventMarkersRef.current) {
      if (!timelineActive) { marker.setOpacity(1); marker.getElement()?.style.setProperty('display', 'block'); continue; }
      if (time > tTo || time < t14d) { marker.setOpacity(0); marker.getElement()?.style.setProperty('display', 'none'); }
      else {
        const opacity = time >= t3d ? 1 : 0.15 + ((time - t14d) / (t3d - t14d)) * 0.85;
        marker.setOpacity(opacity);
        marker.getElement()?.style.setProperty('display', 'block');
      }
    }

    const hmLayer = layersRef.current.heatmap_layer;
    if (hmLayer && layers.heatmap && rawEventsRef.current) {
      const points = rawEventsRef.current.features
        .filter(f => {
          const props = f.properties as any;
          const t = new Date(props.occurred_at).getTime();
          return timelineActive ? (t <= tTo && t >= t14d) : true;
        })
        .map(f => {
          const coords = f.geometry.coordinates as [number, number];
          const props = f.properties as any;
          return [coords[1], coords[0], (props.severity || 5) / 10] as [number, number, number];
        });
      (hmLayer as any).setLatLngs(points);
      // 同时调整热热力图半径，使其随缩放变化
      (hmLayer as any).setOptions({ radius: Math.max(10, 25 * Math.pow(1.2, currentZoom - 5)) });
    }
  }, [timelineTo, timelineActive, dataVersion, layers.events, layers.heatmap, currentZoom]);

  const updateLiveTracking = useCallback(async () => {
    if (!mapRef.current || (timelineActive && timelineTo && Date.now() - timelineTo.getTime() > 3 * 3600 * 1000)) return;
    const acLg = layersRef.current.aircraft;
    const shLg = layersRef.current.ships;
    if (layers.aircraft) {
      const data = await fetchLiveFlights();
      acLg.clearLayers();
      data.aircraft.filter((a: any) => !a.on_ground).forEach((ac: any) => {
        const m = L.marker([ac.lat, ac.lon], { icon: createAircraftIcon(ac.heading, ac.on_ground, ac.origin_country), zIndexOffset: 300 });
        m.bindPopup(`<div style="font-size:11px;min-width:160px"><div style="font-weight:700;color:#00d4ff;margin-bottom:4px">✈ ${ac.callsign}</div><div style="color:#8b9ab0;font-size:10px">${ac.origin_country}</div></div>`, { ...POPUP_OPTS });
        acLg.addLayer(m);
      });
    }
    if (layers.ships) {
      const data = await fetchLiveShips();
      shLg.clearLayers();
      data.ships.forEach((sh: any) => {
        const m = L.marker([sh.lat, sh.lon], { icon: createShipIcon(sh.heading, sh.side, sh.ship_type), zIndexOffset: 250 });
        m.bindPopup(`<div style="font-size:11px;min-width:180px"><div style="font-weight:700;color:#00ff88;margin-bottom:4px">${sh.name}</div></div>`, { ...POPUP_OPTS });
        shLg.addLayer(m);
      });
    }
  }, [layers.aircraft, layers.ships, timelineActive, timelineTo]);

  useEffect(() => {
    const vfLg = layersRef.current.video_feeds;
    if (!vfLg || !mapRef.current) return;
    if (layers.video_feeds) vfLg.addTo(mapRef.current); else mapRef.current.removeLayer(vfLg);
  }, [layers.video_feeds]);

  useEffect(() => {
    updateLiveTracking();
    const interval = setInterval(updateLiveTracking, refreshInterval * 60 * 1000);
    return () => clearInterval(interval);
  }, [updateLiveTracking, refreshInterval]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <LayerControl layers={layers} onToggle={onToggleLayer} />
      <IntensityOverlay timelineActive={timelineActive} aiIntensityScore={aiIntensityScore} />
      {loading && <div style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: 'rgba(13,17,23,0.9)', border: '1px solid #1e2d40', padding: '4px 12px', borderRadius: 4, fontSize: 11, color: '#00d4ff', zIndex: 999 }}>⟳ 加载地图数据...</div>}
    </div>
  );
}
