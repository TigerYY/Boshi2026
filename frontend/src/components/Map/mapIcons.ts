import L from 'leaflet';

const icon = (html: string, size = 28) =>
  L.divIcon({
    html,
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });

// US Navy carrier
export const usCarrierIcon = icon(`
  <div style="width:34px;height:34px;display:flex;align-items:center;justify-content:center;
    background:rgba(26,111,181,0.9);border:2px solid #00d4ff;border-radius:4px;
    font-size:18px;box-shadow:0 0 12px rgba(0,212,255,0.4)">⛴</div>`, 34);

// US destroyer
export const usNavalIcon = icon(`
  <div style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;
    background:rgba(26,111,181,0.85);border:1px solid #4a9dd4;border-radius:3px;font-size:14px">🚢</div>`, 28);

// US airbase
export const usAirIcon = icon(`
  <div style="width:30px;height:30px;display:flex;align-items:center;justify-content:center;
    background:rgba(26,111,181,0.85);border:1px solid #4a9dd4;border-radius:3px;font-size:15px">✈</div>`, 30);

// US army
export const usArmyIcon = icon(`
  <div style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;
    background:rgba(26,111,181,0.85);border:1px solid #4a9dd4;border-radius:3px;
    color:#fff;font-size:11px;font-weight:700;font-family:monospace">USA</div>`, 28);

// Iran missile
export const iranMissileIcon = icon(`
  <div style="width:30px;height:30px;display:flex;align-items:center;justify-content:center;
    background:rgba(180,30,30,0.9);border:2px solid #ff2244;border-radius:3px;
    font-size:15px;box-shadow:0 0 10px rgba(255,34,68,0.3)">🚀</div>`, 30);

// Iran naval
export const iranNavalIcon = icon(`
  <div style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;
    background:rgba(180,30,30,0.85);border:1px solid #ff4444;border-radius:3px;font-size:14px">⚓</div>`, 28);

// Iran army / airbase
export const iranArmyIcon = icon(`
  <div style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;
    background:rgba(180,30,30,0.85);border:1px solid #ff4444;border-radius:3px;
    color:#fff;font-size:10px;font-weight:700">IRN</div>`, 28);

// Proxy force
export const proxyIcon = icon(`
  <div style="width:26px;height:26px;display:flex;align-items:center;justify-content:center;
    background:rgba(160,100,0,0.85);border:1px solid #cc8800;border-radius:3px;font-size:13px">⚔</div>`, 26);

// Event icons by type
const eventBase = (emoji: string, color: string, pulse = false) =>
  icon(`
    <div style="position:relative;width:24px;height:24px">
      ${pulse ? `<div style="position:absolute;inset:0;border-radius:50%;background:${color};opacity:0.25;animation:ping 1.5s cubic-bezier(0,0,.2,1) infinite"></div>` : ''}
      <div style="position:relative;width:24px;height:24px;display:flex;align-items:center;justify-content:center;
        background:${color}cc;border:1.5px solid ${color};border-radius:50%;font-size:12px">${emoji}</div>
    </div>
    <style>@keyframes ping{0%{transform:scale(1);opacity:.5}75%,100%{transform:scale(2);opacity:0}}</style>
  `, 24);

export const airstrikeIcon = eventBase('💥', '#ff6b35', true);
export const missileIcon = eventBase('🚀', '#ff2244', true);
export const navalIcon = eventBase('⚓', '#00d4ff');
export const landIcon = eventBase('🪖', '#00ff88');
export const diplomacyIcon = eventBase('🤝', '#9c66ff');
export const sanctionIcon = eventBase('💰', '#ffdd00');
export const otherIcon = eventBase('📍', '#888888');

export function getEventIcon(type: string) {
  const map: Record<string, L.DivIcon> = {
    airstrike: airstrikeIcon,
    missile: missileIcon,
    naval: navalIcon,
    land: landIcon,
    diplomacy: diplomacyIcon,
    sanction: sanctionIcon,
  };
  return map[type] || otherIcon;
}

export function getUnitIcon(unit_type: string, side: string) {
  if (side === 'US') {
    if (unit_type === 'carrier') return usCarrierIcon;
    if (unit_type === 'destroyer') return usNavalIcon;
    if (unit_type === 'airbase') return usAirIcon;
    return usArmyIcon;
  }
  if (side === 'Iran') {
    if (unit_type === 'missile') return iranMissileIcon;
    if (unit_type === 'destroyer') return iranNavalIcon;
    return iranArmyIcon;
  }
  return proxyIcon;
}
