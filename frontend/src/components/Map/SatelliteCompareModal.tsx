import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const EOX_BASE = 'https://{s}.tiles.maps.eox.at/wmts/1.0.0';
const EOX_OPTS = { subdomains: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], maxZoom: 14 };

const TARGETS = [
  { id: 'natanz', name: '纳坦兹核设施', lat: 33.72, lon: 51.73, zoom: 10 },
  { id: 'bandar_abbas', name: '班达尔阿巴斯', lat: 27.19, lon: 56.27, zoom: 10 },
] as const;

const YEAR_LEFT = '2019';
const YEAR_RIGHT = '2024';
const LAYER_LEFT = 's2cloudless-2019_3857';
const LAYER_RIGHT = 's2cloudless-2024';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function SatelliteCompareModal({ isOpen, onClose }: Props) {
  const [targetId, setTargetId] = useState<string>(TARGETS[0].id);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const mapLeftRef = useRef<L.Map | null>(null);
  const mapRightRef = useRef<L.Map | null>(null);

  const target = TARGETS.find(t => t.id === targetId) ?? TARGETS[0];

  useEffect(() => {
    if (!isOpen || !leftRef.current || !rightRef.current) return;

    const center: [number, number] = [target.lat, target.lon];
    const zoom = target.zoom;

    const layerLeft = L.tileLayer(
      `${EOX_BASE}/${LAYER_LEFT}/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg`,
      { ...EOX_OPTS, attribution: `© <a href="https://s2maps.eu">Sentinel-2 cloudless</a> (${YEAR_LEFT})` }
    );
    const layerRight = L.tileLayer(
      `${EOX_BASE}/${LAYER_RIGHT}/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg`,
      { ...EOX_OPTS, attribution: `© <a href="https://s2maps.eu">Sentinel-2 cloudless</a> (${YEAR_RIGHT})` }
    );

    const mapLeft = L.map(leftRef.current, { center, zoom, zoomControl: true, attributionControl: false });
    const mapRight = L.map(rightRef.current, { center, zoom, zoomControl: true, attributionControl: false });

    layerLeft.addTo(mapLeft);
    layerRight.addTo(mapRight);

    const sync = (from: L.Map, to: L.Map) => {
      to.setView(from.getCenter(), from.getZoom());
    };
    mapLeft.on('moveend', () => sync(mapLeft, mapRight));
    mapRight.on('moveend', () => sync(mapRight, mapLeft));

    mapLeftRef.current = mapLeft;
    mapRightRef.current = mapRight;

    return () => {
      mapLeft.remove();
      mapRight.remove();
      mapLeftRef.current = null;
      mapRightRef.current = null;
    };
  }, [isOpen, targetId, target.lat, target.lon, target.zoom]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        className="hud-panel corner-brackets"
        style={{
          background: 'rgba(8, 12, 18, 0.98)',
          border: '1px solid #1e2d40',
          borderRadius: 6,
          maxWidth: 920,
          width: '100%',
          maxHeight: '90vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #1e2d40', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#00d4ff' }}>卫星影像前后对比</span>
            <label style={{ fontSize: 11, color: '#556677' }}>
              目标：
              <select
                value={targetId}
                onChange={e => setTargetId(e.target.value)}
                style={{
                  marginLeft: 6,
                  padding: '4px 8px',
                  background: '#0a0e14',
                  border: '1px solid #1e2d40',
                  color: '#c9d1d9',
                  borderRadius: 2,
                  fontSize: 11,
                }}
              >
                {TARGETS.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </label>
          </div>
          <button
            onClick={onClose}
            style={{
              padding: '4px 12px',
              fontSize: 11,
              background: 'transparent',
              border: '1px solid #1e2d40',
              color: '#556677',
              borderRadius: 2,
              cursor: 'pointer',
            }}
          >
            关闭
          </button>
        </div>
        <div style={{ display: 'flex', flex: 1, minHeight: 400 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid #1e2d40' }}>
            <div style={{ padding: '6px 10px', background: 'rgba(0,0,0,0.3)', fontSize: 11, color: '#00d4ff', fontWeight: 600 }}>
              {YEAR_LEFT} 年
            </div>
            <div ref={leftRef} style={{ flex: 1, minHeight: 320 }} />
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '6px 10px', background: 'rgba(0,0,0,0.3)', fontSize: 11, color: '#00d4ff', fontWeight: 600 }}>
              {YEAR_RIGHT} 年
            </div>
            <div ref={rightRef} style={{ flex: 1, minHeight: 320 }} />
          </div>
        </div>
        <div style={{ padding: '8px 16px', fontSize: 10, color: '#445566', borderTop: '1px solid #1e2d40' }}>
          © Sentinel-2 cloudless by EOX (Contains modified Copernicus Sentinel data). 左右视口同步平移与缩放。
        </div>
      </div>
    </div>
  );
}
