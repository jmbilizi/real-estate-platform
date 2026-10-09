import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import { useMapExpand } from '@/lib/useMapExpand';
import ToolbarIconButton, {
  CLEAR_ICON,
  DRAW_ICON,
  EXIT_EXPAND_ICON,
  EXPAND_ICON,
  FILTERS_ICON,
  GROUP_ICON,
  MINUS_ICON,
  PLUS_ICON,
} from '@/components/ToolbarIconButton';

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
        <ToolbarIconButton
          data-testid="map-expand"
          label="Exit full screen map"
          icon={EXIT_EXPAND_ICON}
          onClick={exit}
        />
      ) : (
        <ToolbarIconButton
          data-testid="map-expand"
          label="Full screen map"
          icon={EXPAND_ICON}
          onClick={enter}
        />
      )}
      {draw && (
        <>
          <ToolbarIconButton
            data-testid="map-draw"
            label={draw.drawing ? 'Cancel drawing' : draw.hasArea ? 'Redraw area' : 'Draw an area'}
            icon={DRAW_ICON}
            pressed={draw.drawing}
            onClick={draw.onToggle}
          />
          {draw.hasArea && !draw.drawing && (
            <ToolbarIconButton
              data-testid="map-draw-clear"
              label="Clear drawn area"
              icon={CLEAR_ICON}
              onClick={draw.onClear}
            />
          )}
        </>
      )}
      {/* The toolbar is hidden behind the expanded map, so its filter and group controls move here. */}
      {expanded && viewControls && (
        <>
          <ToolbarIconButton
            data-testid="map-filters"
            countTestId="map-filters-count"
            label={
              viewControls.filterCount > 0
                ? `Open filters, ${viewControls.filterCount} active`
                : 'Open filters'
            }
            icon={FILTERS_ICON}
            count={viewControls.filterCount}
            onClick={viewControls.onOpenFilters}
          />
          <ToolbarIconButton
            data-testid="map-group"
            label="Group by neighborhood"
            icon={GROUP_ICON}
            pressed={viewControls.grouped}
            onClick={viewControls.onToggleGroup}
          />
        </>
      )}
      <ToolbarIconButton label="Zoom in" icon={PLUS_ICON} onClick={() => map.zoomIn()} />
      <ToolbarIconButton label="Zoom out" icon={MINUS_ICON} onClick={() => map.zoomOut()} />
    </div>
  );
}
