import type { MilitaryEvent } from '../../api/types';
import { format } from 'date-fns';

const SIDE_COLORS: Record<string, string> = {
  US: '#1a6fb5', Iran: '#cc2222', proxy: '#cc8800', neutral: '#666',
};

const TYPE_LABELS: Record<string, string> = {
  airstrike: '空袭', missile: '导弹', naval: '海战', land: '地面',
  diplomacy: '外交', sanction: '制裁', movement: '调动', other: '其他',
};

export default function EventPopup({ event }: { event: MilitaryEvent }) {
  const color = SIDE_COLORS[event.side || 'neutral'] || '#666';
  return (
    <div style={{ minWidth: 220, maxWidth: 280 }}>
      <div style={{ borderBottom: '1px solid #1e2d40', paddingBottom: 6, marginBottom: 8 }}>
        <span style={{
          display: 'inline-block', background: color, color: '#fff',
          padding: '1px 6px', borderRadius: 2, fontSize: 10, fontWeight: 700,
          textTransform: 'uppercase', marginRight: 6,
        }}>
          {event.side}
        </span>
        <span style={{
          display: 'inline-block', background: '#1e2d40', color: '#00d4ff',
          padding: '1px 6px', borderRadius: 2, fontSize: 10,
        }}>
          {TYPE_LABELS[event.event_type] || event.event_type}
        </span>
        {!event.confirmed && (
          <span style={{
            display: 'inline-block', background: '#332200', color: '#cc8800',
            padding: '1px 6px', borderRadius: 2, fontSize: 9, marginLeft: 4,
          }}>未确认</span>
        )}
      </div>
      <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6, lineHeight: 1.4 }}>
        {event.title}
      </div>
      {event.description && (
        <div style={{ fontSize: 11, color: '#8b9ab0', marginBottom: 6, lineHeight: 1.5 }}>
          {event.description}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#556677' }}>
        <span>📍 {event.location_name || '未知位置'}</span>
        <span>烈度 {'▮'.repeat(event.severity)}{'▯'.repeat(5 - event.severity)}</span>
      </div>
      {event.occurred_at && (
        <div style={{ fontSize: 10, color: '#445566', marginTop: 4 }}>
          🕐 {format(new Date(event.occurred_at), 'yyyy-MM-dd HH:mm')} UTC
        </div>
      )}
    </div>
  );
}
