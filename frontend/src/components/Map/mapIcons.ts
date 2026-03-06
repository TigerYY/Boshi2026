import L from 'leaflet';

const icon = (html: string, size = 28) =>
  L.divIcon({
    html,
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });

// --- NEW SVG ICONS ---
const svgAirplane = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" stroke="rgba(255,255,255,0.4)" stroke-width="0.5"><path d="M21,11.5c0-1.4-1.1-2.5-2.5-2.5h-5.4L8.8,3.2C8.6,3.1,8.3,3,8,3H7.3c-0.2,0-0.4,0.1-0.4,0.3L8.6,9H4.5l-1.8-2H2v2.8c0,0.1,0.1,0.2,0.2,0.2h19.6C21.9,10,22,10.1,22,10.2L21,11.5z"></path></svg>`;
const svgShip = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" stroke="rgba(255,255,255,0.4)" stroke-width="0.5"><path d="M2,16v2c0,0.6,0.4,1,1,1h18c0.6,0,1-0.4,1-1v-2l-2-2v-4c0-0.6-0.4-1-1-1h-2V7c0-0.6-0.4-1-1-1h-8C7.4,6,7,6.4,7,7v3H5c-0.6,0-1,0.4-1,1v4L2,16z M9,8h6v2H9V8z M7,12h10v2H7V12z"></path></svg>`;
const svgArmy = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path></svg>`;

// US Navy carrier (using ship SVG, scaled up slightly)
export const usCarrierIcon = icon(`
  <div style="width:34px;height:34px;display:flex;align-items:center;justify-content:center;
    background:rgba(26,111,181,0.9);border:2px solid #00d4ff;border-radius:4px;
    color:#fff;box-shadow:0 0 12px rgba(0,212,255,0.4)">
    <svg viewBox="0 0 24 24" width="22" height="22" fill="#fff"><path d="M3,15h18v4H3V15z M3,11h3v2H3V11z M8,11h3v2H8V11z M13,11h3v2h-3V11z M18,11h3v2h-3V11z M4,7h16v2H4V7z"></path></svg>
  </div>`, 34);

// US destroyer
export const usNavalIcon = icon(`
  <div style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;
    background:rgba(26,111,181,0.85);border:1px solid #4a9dd4;border-radius:3px;color:#fff">${svgShip}</div>`, 28);

// US airbase
export const usAirIcon = icon(`
  <div style="width:30px;height:30px;display:flex;align-items:center;justify-content:center;
    background:rgba(26,111,181,0.85);border:1px solid #4a9dd4;border-radius:3px;color:#fff">${svgAirplane}</div>`, 30);

// US army
export const usArmyIcon = icon(`
  <div style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;
    background:rgba(26,111,181,0.85);border:1px solid #4a9dd4;border-radius:3px;
    color:#fff;">${svgArmy}</div>`, 28);

// Iran missile
export const iranMissileIcon = icon(`
  <div style="width:30px;height:30px;display:flex;align-items:center;justify-content:center;
    background:rgba(180,30,30,0.9);border:2px solid #ff2244;border-radius:3px;
    color:#fff;box-shadow:0 0 10px rgba(255,34,68,0.3)">
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5z M10 14v4h-2v-4H6.5L10 9l3.5 5H10z"></path></svg>
  </div>`, 30);

// Iran naval
export const iranNavalIcon = icon(`
  <div style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;
    background:rgba(180,30,30,0.85);border:1px solid #ff4444;border-radius:3px;color:#fff">${svgShip}</div>`, 28);

// Iran army / airbase
export const iranArmyIcon = icon(`
  <div style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;
    background:rgba(180,30,30,0.85);border:1px solid #ff4444;border-radius:3px;
    color:#fff;">${svgArmy}</div>`, 28);

// Proxy force
export const proxyIcon = icon(`
  <div style="width:26px;height:26px;display:flex;align-items:center;justify-content:center;
    background:rgba(160,100,0,0.85);border:1px solid #cc8800;border-radius:3px;color:#fff">${svgArmy}</div>`, 26);

// Event icons by type
const eventBase = (emoji: string, color: string, isAttack = false) => {
  const innerHtml = isAttack ? `
    <div style="position:absolute;inset:-8px;border:1.5px solid ${color};border-radius:50%;border-left-color:transparent;border-right-color:transparent;animation:spin 3s linear infinite"></div>
    <div style="position:absolute;inset:-4px;border:1px dashed ${color};border-radius:50%;opacity:0.6;animation:spin 8s linear infinite reverse"></div>
    <div style="position:relative;width:24px;height:24px;display:flex;align-items:center;justify-content:center;
      background:${color}99;border:2px solid ${color};border-radius:50%;font-size:12px;box-shadow:0 0 12px ${color};">${emoji}</div>
    <style>@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}</style>
  ` : `
    <div style="position:relative;width:24px;height:24px;display:flex;align-items:center;justify-content:center;
      background:${color}cc;border:1.5px solid ${color};border-radius:50%;font-size:12px">${emoji}</div>
  `;
  return icon(`
    <div style="position:relative;width:24px;height:24px;display:flex;align-items:center;justify-content:center;">
      ${innerHtml}
    </div>
  `, 24);
};

export const airstrikeIcon = eventBase('💥', '#ff6b35', true);
export const missileIcon = eventBase('🚀', '#ff2244', true);
export const navalIcon = eventBase('⚓', '#00d4ff', false);
export const landIcon = eventBase('🪖', '#00ff88', false);
export const diplomacyIcon = eventBase('🤝', '#9c66ff', false);
export const sanctionIcon = eventBase('💰', '#ffdd00', false);
export const otherIcon = eventBase('📍', '#888888', false);

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
