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
const LAYER_LEFT = 's2cloudless-2019_3857';

/** 右侧可选：2024 年度无云 mosaic；或 EOX 滚动「最新」底图（无 2025 年度层时更接近现时） */
const RIGHT_IMAGERY_OPTIONS = [
  {
    id: '2024',
    shortLabel: '2024 年度',
    headerLabel: '2024 年',
    layerId: 's2cloudless-2024_3857',
    desc: 'Sentinel-2 年度无云合成',
  },
  {
    id: 'latest',
    shortLabel: '最新（滚动）',
    headerLabel: '最新',
    layerId: 's2cloudless_3857',
    desc: 'EOX 滚动无云底图，持续更新',
  },
] as const;

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function SatelliteCompareModal({ isOpen, onClose }: Props) {
  const [targetId, setTargetId] = useState<string>(TARGETS[0].id);
  const [rightImageryId, setRightImageryId] = useState<string>(RIGHT_IMAGERY_OPTIONS[0].id);
  const rightOpt =
    RIGHT_IMAGERY_OPTIONS.find((o) => o.id === rightImageryId) ?? RIGHT_IMAGERY_OPTIONS[0];

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
      `${EOX_BASE}/${rightOpt.layerId}/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg`,
      {
        ...EOX_OPTS,
        attribution: `© <a href="https://s2maps.eu">Sentinel-2 cloudless</a> (${rightOpt.headerLabel})`,
      }
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
  }, [isOpen, targetId, target.lat, target.lon, target.zoom, rightImageryId]);

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
                onChange={(e) => setTargetId(e.target.value)}
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
                {TARGETS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 11, color: '#556677' }}>
              右侧：
              <select
                value={rightImageryId}
                onChange={(e) => setRightImageryId(e.target.value)}
                title="EOX 暂无 2025 年度无云切片；可选「最新」使用滚动更新底图"
                style={{
                  marginLeft: 6,
                  padding: '4px 8px',
                  background: '#0a0e14',
                  border: '1px solid #1e2d40',
                  color: '#c9d1d9',
                  borderRadius: 2,
                  fontSize: 11,
                  maxWidth: 200,
                }}
              >
                {RIGHT_IMAGERY_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.shortLabel}
                  </option>
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
            <div
              style={{
                padding: '6px 10px',
                background: 'rgba(0,0,0,0.3)',
                fontSize: 11,
                color: '#00d4ff',
                fontWeight: 600,
              }}
            >
              {rightOpt.headerLabel}
              {rightOpt.id === '2024' ? ' 年' : ''}
              <span style={{ fontWeight: 400, color: '#556677', marginLeft: 6 }}>{rightOpt.desc}</span>
            </div>
            <div ref={rightRef} style={{ flex: 1, minHeight: 320 }} />
          </div>
        </div>
        <div style={{ padding: '8px 16px', fontSize: 10, color: '#445566', borderTop: '1px solid #1e2d40' }}>
          © Sentinel-2 cloudless by EOX (Contains modified Copernicus Sentinel data). 左右视口同步平移与缩放。
          <span style={{ display: 'block', marginTop: 4, color: '#556677' }}>
            说明：EOX 目前提供 2024 年度无云合成；尚无 2025 年度公开瓦片。选「最新（滚动）」为 EOX
            持续维护的合成底图，更接近当前地表，但与左侧 2019 年对比时语义为「近年」而非固定年份。
          </span>
        </div>
      </div>
    </div>
  );
}
