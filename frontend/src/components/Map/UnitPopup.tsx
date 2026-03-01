import type { MilitaryUnit } from '../../api/types';

const SIDE_COLORS: Record<string, string> = {
  US: '#1a6fb5', Iran: '#cc2222', proxy: '#cc8800',
};

const TYPE_LABELS: Record<string, string> = {
  carrier: '航母', destroyer: '驱逐舰/舰艇', airbase: '空军基地',
  army: '陆军部队', missile: '导弹阵地', drone: '无人机部队',
};

const STATUS_COLORS: Record<string, string> = {
  deployed: '#00ff88', moving: '#ffdd00', engaged: '#ff6b35', withdrawn: '#888',
};

const STATUS_LABELS: Record<string, string> = {
  deployed: '部署中', moving: '移动中', engaged: '交战中', withdrawn: '撤退',
};

export default function UnitPopup({ unit }: { unit: MilitaryUnit }) {
  const sideColor = SIDE_COLORS[unit.side] || '#666';
  const statusColor = STATUS_COLORS[unit.status] || '#888';

  return (
    <div style={{ minWidth: 200, maxWidth: 260 }}>
      <div style={{ borderBottom: '1px solid #1e2d40', paddingBottom: 6, marginBottom: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ background: sideColor, color: '#fff', padding: '1px 6px', borderRadius: 2, fontSize: 10, fontWeight: 700 }}>
          {unit.side}
        </span>
        <span style={{ background: '#1e2d40', color: '#00d4ff', padding: '1px 6px', borderRadius: 2, fontSize: 10 }}>
          {TYPE_LABELS[unit.unit_type] || unit.unit_type}
        </span>
        <span style={{ color: statusColor, fontSize: 10 }}>
          ● {STATUS_LABELS[unit.status] || unit.status}
        </span>
      </div>
      <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6, lineHeight: 1.4 }}>
        {unit.name}
      </div>
      <div style={{ fontSize: 10, color: '#556677' }}>
        📍 {unit.location_name}
      </div>
      {unit.extra && Object.keys(unit.extra).length > 0 && (
        <div style={{ marginTop: 8, borderTop: '1px solid #1e2d40', paddingTop: 6 }}>
          {Object.entries(unit.extra).filter(([, v]) => v != null).map(([k, v]) => (
            <div key={k} style={{ fontSize: 10, color: '#8b9ab0', display: 'flex', gap: 4 }}>
              <span style={{ color: '#445566', minWidth: 60 }}>{k}:</span>
              <span>{String(v)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
