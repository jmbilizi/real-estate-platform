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

const PRESSED_STYLE = { background: '#222' } as const;

/** What the expanded map needs from the results toolbar for its filter and group buttons. */
export interface ViewControls {
  filterCount: number;
  onOpenFilters: () => void;
  grouped: boolean;
  onToggleGroup: () => void;
}

/** The draw-an-area controls (#747). */
export interface DrawControls {
  drawing: boolean;
  hasArea: boolean;
  /** Starts draw mode, or ends it with no shape while it is on. */
  onToggle: () => void;
  onClear: () => void;
}

// Custom zoom and expand controls styled for top right
export function CustomMapControls({
  viewControls,
  draw,
}: {
  viewControls?: ViewControls;
  draw?: DrawControls;
}) {
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
        gap: draw ? 12 : 18,
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
      {draw && (
        <>
          <button
            type="button"
            data-testid="map-draw"
            aria-label={
              draw.drawing ? 'Cancel drawing' : draw.hasArea ? 'Redraw area' : 'Draw an area'
            }
            aria-pressed={draw.drawing}
            onClick={draw.onToggle}
            style={draw.drawing ? { ...BUTTON_STYLE, ...PRESSED_STYLE } : BUTTON_STYLE}
          >
            <svg
              {...ICON_PROPS}
              viewBox="0 0 24 24"
              strokeWidth={1.8}
              stroke={draw.drawing ? '#fff' : '#222'}
            >
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </button>
          {draw.hasArea && !draw.drawing && (
            <button
              type="button"
              data-testid="map-draw-clear"
              aria-label="Clear drawn area"
              onClick={draw.onClear}
              style={BUTTON_STYLE}
            >
              <svg {...ICON_PROPS} viewBox="0 0 24 24" strokeWidth={2}>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          )}
        </>
      )}
      {/* The toolbar is hidden behind the expanded map, so its filter and group controls move here. */}
      {expanded && viewControls && (
        <>
          <button
            type="button"
            data-testid="map-filters"
            aria-label={
              viewControls.filterCount > 0
                ? `Open filters, ${viewControls.filterCount} active`
                : 'Open filters'
            }
            onClick={viewControls.onOpenFilters}
            style={{ ...BUTTON_STYLE, position: 'relative' }}
          >
            <svg {...ICON_PROPS} viewBox="0 0 24 24" strokeWidth={1.8}>
              <circle cx="17" cy="5" r="2" />
              <circle cx="7" cy="12" r="2" />
              <circle cx="17" cy="19" r="2" />
              <line x1="3" y1="5" x2="15" y2="5" />
              <line x1="9" y1="12" x2="21" y2="12" />
              <line x1="3" y1="19" x2="15" y2="19" />
            </svg>
            {viewControls.filterCount > 0 && (
              <span
                aria-hidden="true"
                data-testid="map-filters-count"
                style={{
                  position: 'absolute',
                  top: -2,
                  right: -2,
                  minWidth: 18,
                  height: 18,
                  padding: '0 4px',
                  borderRadius: 9,
                  background: '#222',
                  color: '#fff',
                  fontSize: 11,
                  fontWeight: 700,
                  lineHeight: '18px',
                  textAlign: 'center',
                  boxSizing: 'border-box',
                }}
              >
                {viewControls.filterCount}
              </span>
            )}
          </button>
          <button
            type="button"
            data-testid="map-group"
            aria-label="Group by neighborhood"
            aria-pressed={viewControls.grouped}
            onClick={viewControls.onToggleGroup}
            style={viewControls.grouped ? { ...BUTTON_STYLE, ...PRESSED_STYLE } : BUTTON_STYLE}
          >
            <svg
              {...ICON_PROPS}
              viewBox="0 0 24 24"
              strokeWidth={1.8}
              stroke={viewControls.grouped ? '#fff' : '#222'}
            >
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
            </svg>
          </button>
        </>
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
