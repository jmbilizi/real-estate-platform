import { trackEvent } from './analytics';

const cell = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

/**
 * Sends `map_move` for a settled user move (#826). The cell is the view centre rounded to 2
 * decimals, about 1 km. The event never carries an exact point or the view edges.
 * Returns the zoom to compare with the next move.
 */
export function reportMapMove(
  view: { west: number; south: number; east: number; north: number; zoom: number },
  previousZoom: number,
): number {
  const zoom = Math.min(22, Math.max(0, Math.round(view.zoom)));
  const lat = (view.south + view.north) / 2;
  const lng = (view.west + view.east) / 2;
  // One invalid event rejects its whole batch.
  if (!Number.isFinite(lat + lng)) return previousZoom;
  trackEvent('map_move', {
    surface: 'map',
    props: {
      zoom,
      bbox_cell: `${cell(lat)}:${cell(lng)}`,
      trigger: zoom !== previousZoom ? 'zoom' : 'pan',
    },
  });
  return zoom;
}
