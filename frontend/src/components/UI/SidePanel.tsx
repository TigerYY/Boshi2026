import type { ReactNode } from 'react';

interface PanelTab {
  id: string;
  label: string;
  icon: string;
  badge?: number;
}

interface Props {
  tabs: PanelTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  children: ReactNode;
}

export default function SidePanel({ tabs, activeTab, onTabChange, children }: Props) {
  return (
    <div className="hud-panel corner-brackets" style={{
      width: 300,
      height: '100%',
      display: 'flex', flexDirection: 'column',
      borderLeft: '1px solid #1e2d40',
      background: 'rgba(10,14,20,0.96)',
      flexShrink: 0,
    }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid #1e2d40', flexShrink: 0 }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            style={{
              flex: 1, padding: '8px 4px', fontSize: 10, cursor: 'pointer',
              background: activeTab === tab.id ? 'rgba(0,212,255,0.07)' : 'transparent',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid #00d4ff' : '2px solid transparent',
              color: activeTab === tab.id ? '#00d4ff' : '#445566',
              fontFamily: 'inherit', fontWeight: activeTab === tab.id ? 600 : 400,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              position: 'relative',
            }}
          >
            <span style={{ fontSize: 14 }}>{tab.icon}</span>
            <span style={{ letterSpacing: '0.05em' }}>{tab.label}</span>
            {tab.badge != null && tab.badge > 0 && (
              <span style={{
                position: 'absolute', top: 4, right: '20%',
                background: '#ff2244', color: '#fff', fontSize: 8,
                padding: '0 3px', borderRadius: 6, minWidth: 12, textAlign: 'center',
              }}>{tab.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {children}
      </div>
    </div>
  );
}
