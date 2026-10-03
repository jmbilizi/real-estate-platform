import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import { useMapExpand } from '@/lib/useMapExpand';

const BUTTON_STYLE = {
  background: '#fff',
  border: 'none',
  borderRadius: '50%',
  boxShadow: '0 4px 16px 0 rgba(34,34,34,0.10)',
  width: 44,
  height: 44,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  margin: '0 auto 8px auto',
  transition: 'box-shadow 0.15s, background 0.15s',
} as const;

const ICON_PROPS = {
  width: 22,
  height: 22,
  viewBox: '0 0 22 22',
  fill: 'none',
  stroke: '#222',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

const ZOOM_BUTTON_STYLE = {
  width: 48,
  height: 38,
  border: 'none',
  background: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  fontSize: 24,
  color: '#222',
  borderRadius: 0,
  transition: 'background 0.15s',
} as const;

// Custom zoom and expand controls styled for top right
export function CustomMapControls() {
  const map = useMap();
  const { expanded, enter, exit } = useMapExpand(map.getContainer());
  // Leaflet learns about window resizes by itself, but not about the container growing or
  // shrinking because of an expand or an exit.
  useEffect(() => {
    map.invalidateSize?.();
  }, [expanded, map]);
  return (
    <div
      style={{
        position: 'absolute',
        top: 24,
        right: 24,
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        alignItems: 'start',
      }}
    >
      {/* One slot, one corner: the expand control and the exit control swap in place. */}
      {expanded ? (
        <button type="button" aria-label="Exit full screen map" onClick={exit} style={BUTTON_STYLE}>
          <svg {...ICON_PROPS}>
            <path d="M3 7h4V3" />
            <path d="M19 7h-4V3" />
            <path d="M3 15h4v4" />
            <path d="M19 15h-4v4" />
          </svg>
        </button>
      ) : (
        <button type="button" aria-label="Full screen map" onClick={enter} style={BUTTON_STYLE}>
          <svg {...ICON_PROPS}>
            <path d="M7 3H3v4" />
            <path d="M15 3h4v4" />
            <path d="M3 15v4h4" />
            <path d="M19 15v4h-4" />
          </svg>
        </button>
      )}
      {/* Zoom controls */}
      <div
        style={{
          background: '#fff',
          borderRadius: 18,
          boxShadow: '0 4px 16px 0 rgba(34,34,34,0.10)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          overflow: 'hidden',
          width: 48,
        }}
      >
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => map.zoomIn()}
          style={{ ...ZOOM_BUTTON_STYLE, borderBottom: '1px solid #e5e7eb' }}
        >
          <svg {...ICON_PROPS} strokeWidth={2.2}>
            <line x1="11" y1="5" x2="11" y2="17" />
            <line x1="5" y1="11" x2="17" y2="11" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => map.zoomOut()}
          style={ZOOM_BUTTON_STYLE}
        >
          <svg {...ICON_PROPS} strokeWidth={2.2}>
            <line x1="5" y1="11" x2="17" y2="11" />
          </svg>
        </button>
      </div>
    </div>
  );
}
