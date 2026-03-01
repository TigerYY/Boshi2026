import { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LayerVisibility } from '../../store/useAppStore';
import type { MilitaryEvent, MilitaryUnit } from '../../api/types';
import { fetchEventsGeoJson, fetchUnitsGeoJson, fetchZonesGeoJson } from '../../api/client';
import { getEventIcon, getUnitIcon } from './mapIcons';
import EventPopup from './EventPopup';
import UnitPopup from './UnitPopup';
import LayerControl from './LayerControl';

interface Props {
  layers: LayerVisibility;
  onToggleLayer: (key: keyof LayerVisibility) => void;
  timelineFrom?: Date | null;
  timelineTo?: Date | null;
  onEventSelect?: (event: MilitaryEvent) => void;
}

const ZONE_COLORS: Record<string, string> = {
  patrol: '#1a6fb5', exclusion: '#cc2222', blockade: '#cc8800', control: '#9c66ff',
};

export default function WarfareMap({ layers, onToggleLayer, timelineFrom, timelineTo, onEventSelect }: Props) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const layersRef = useRef<Record<string, L.LayerGroup>>({});
  const [loading, setLoading] = useState(true);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [28, 52],
      zoom: 5,
      minZoom: 3,
      maxZoom: 14,
      zoomControl: true,
    });

    // 高德中文瓦片 — style=8 灰色底图，配合 CSS 暗色滤镜呈现军事风格
    L.tileLayer(
      'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
      {
        subdomains: ['1', '2', '3', '4'],
        attribution: '© 高德地图 AutoNavi',
        maxZoom: 18,
      }
    ).addTo(map);

    // Create layer groups
    layersRef.current = {
      us_units: L.layerGroup().addTo(map),
      iran_units: L.layerGroup().addTo(map),
      proxy_units: L.layerGroup().addTo(map),
      events: L.layerGroup().addTo(map),
      control_zones: L.layerGroup().addTo(map),
    };

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  const loadData = useCallback(async () => {
    if (!mapRef.current) return;
    setLoading(true);
    try {
      const params: { since?: string; until?: string } = {};
      if (timelineFrom) params.since = timelineFrom.toISOString();
      if (timelineTo) params.until = timelineTo.toISOString();

      const [eventsGeo, unitsGeo, zonesGeo] = await Promise.all([
        fetchEventsGeoJson(params),
        fetchUnitsGeoJson(),
        fetchZonesGeoJson(),
      ]);

      // ── Events layer ────────────────────────────────────────────────────
      const eventsLg = layersRef.current.events;
      eventsLg.clearLayers();
      if (layers.events) {
        for (const f of eventsGeo.features) {
          const e = f.properties as MilitaryEvent;
          const coords = f.geometry.coordinates as [number, number];
          const marker = L.marker([coords[1], coords[0]], { icon: getEventIcon(e.event_type) });
          marker.bindPopup(renderToStaticMarkup(<EventPopup event={e} />), { maxWidth: 300 });
          marker.on('click', () => onEventSelect?.(e));
          eventsLg.addLayer(marker);
        }
      }

      // ── Units layers ────────────────────────────────────────────────────
      const unitsBySide: Record<string, MilitaryUnit[]> = { US: [], Iran: [], proxy: [] };
      for (const f of unitsGeo.features) {
        const u = f.properties as MilitaryUnit;
        if (unitsBySide[u.side]) unitsBySide[u.side].push(u);
      }

      const unitLayerKeys: Array<[string, keyof LayerVisibility]> = [
        ['US', 'us_units'], ['Iran', 'iran_units'], ['proxy', 'proxy_units'],
      ];

      for (const [side, layerKey] of unitLayerKeys) {
        const lg = layersRef.current[layerKey];
        lg.clearLayers();
        if (layers[layerKey]) {
          for (const f of unitsGeo.features) {
            const u = f.properties as MilitaryUnit;
            if (u.side !== side) continue;
            const coords = f.geometry.coordinates as [number, number];
            const marker = L.marker([coords[1], coords[0]], {
              icon: getUnitIcon(u.unit_type, u.side),
            });
            marker.bindPopup(renderToStaticMarkup(<UnitPopup unit={u} />), { maxWidth: 280 });
            lg.addLayer(marker);
          }
        }
      }

      // ── Control zones ───────────────────────────────────────────────────
      const zonesLg = layersRef.current.control_zones;
      zonesLg.clearLayers();
      if (layers.control_zones) {
        for (const f of zonesGeo.features) {
          const props = f.properties as { name: string; zone_type: string; side: string };
          const color = ZONE_COLORS[props.zone_type] || '#888';
          const geoLayer = L.geoJSON(f as GeoJSON.Feature, {
            style: {
              color,
              weight: 1.5,
              opacity: 0.7,
              fillOpacity: 0.08,
              fillColor: color,
              dashArray: props.zone_type === 'exclusion' ? '8,4' : undefined,
            },
          });
          geoLayer.bindPopup(`
            <div style="font-size:12px">
              <div style="font-weight:600;margin-bottom:4px">${props.name}</div>
              <div style="font-size:10px;color:#8b9ab0">${props.zone_type.toUpperCase()} | ${props.side}</div>
            </div>
          `);
          zonesLg.addLayer(geoLayer);
        }
      }
    } catch (err) {
      console.error('Map data load error:', err);
    } finally {
      setLoading(false);
    }
  }, [layers, timelineFrom, timelineTo, onEventSelect]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Expose refresh
  useEffect(() => {
    (window as Record<string, unknown>).__warfareMapRefresh = loadData;
    return () => { delete (window as Record<string, unknown>).__warfareMapRefresh; };
  }, [loadData]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <LayerControl layers={layers} onToggle={onToggleLayer} />
      {loading && (
        <div style={{
          position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(13,17,23,0.9)', border: '1px solid #1e2d40',
          padding: '4px 12px', borderRadius: 4, fontSize: 11, color: '#00d4ff', zIndex: 999,
        }}>
          ⟳ 加载地图数据...
        </div>
      )}
    </div>
  );
}
