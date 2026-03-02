import type { LayerVisibility } from '../../store/useAppStore';

interface Props {
  layers: LayerVisibility;
  onToggle: (key: keyof LayerVisibility) => void;
}

const LAYER_CONFIG: Array<{
  key: keyof LayerVisibility;
  label: string;
  color: string;
  icon: string;
}> = [
  { key: 'us_units', label: '美军部署', color: '#1a6fb5', icon: '🇺🇸' },
  { key: 'iran_units', label: '伊朗军力', color: '#cc2222', icon: '🇮🇷' },
  { key: 'proxy_units', label: '代理武装', color: '#cc8800', icon: '⚔' },
  { key: 'events', label: '冲突事件', color: '#ff6b35', icon: '💥' },
  { key: 'control_zones', label: '控制区域', color: '#9c66ff', icon: '▭' },
  { key: 'aircraft', label: '实时航班', color: '#00d4ff', icon: '✈' },
  { key: 'ships', label: '舰船动态', color: '#00ff88', icon: '⛵' },
  { key: 'video_feeds', label: '实况视频', color: '#ff6b35', icon: '📹' },
  { key: 'heatmap', label: '热力图', color: '#ff2244', icon: '🔥' },
];

export default function LayerControl({ layers, onToggle }: Props) {
  return (
    <div className="mil-panel" style={{
      position: 'absolute', top: 10, right: 10, zIndex: 1000,
      borderRadius: 4, overflow: 'hidden', minWidth: 160,
    }}>
      <div className="mil-panel-header">
        <span>▦</span> 图层控制
      </div>
      <div style={{ padding: '4px 0' }}>
        {LAYER_CONFIG.map(({ key, label, color, icon }) => {
          const active = layers[key];
          return (
            <button
              key={key}
              onClick={() => onToggle(key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '6px 12px', background: 'transparent', border: 'none',
                cursor: 'pointer', transition: 'background 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#1e2d4033')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ fontSize: 13 }}>{icon}</span>
              <span style={{ flex: 1, fontSize: 11, color: active ? '#c9d1d9' : '#445566', textAlign: 'left' }}>
                {label}
              </span>
              <span style={{
                width: 28, height: 14, borderRadius: 7, display: 'flex', alignItems: 'center',
                background: active ? color : '#1e2d40',
                transition: 'background 0.2s', padding: '0 2px',
              }}>
                <span style={{
                  width: 10, height: 10, borderRadius: '50%', background: '#fff',
                  transform: active ? 'translateX(14px)' : 'translateX(0)',
                  transition: 'transform 0.2s',
                }} />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
