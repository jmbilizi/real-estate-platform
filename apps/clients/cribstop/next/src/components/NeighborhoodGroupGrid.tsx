import type { NeighborhoodRow } from '@cribstop/property-contracts';
import { NeighborhoodTile, NeighborhoodTileSkeleton } from '@/components/NeighborhoodRow';
import { toNeighborhood } from '@/lib/neighborhoods';

/** The results column is half the screen from `md`, so the grid has fewer columns than the page. */
const GROUP_GRID_CLASS =
  'grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4';

/** The grid's loading state. Same grid class and tile box as the loaded grid. */
export function NeighborhoodGroupGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className={GROUP_GRID_CLASS} data-testid="neighborhood-group-skeleton" aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <NeighborhoodTileSkeleton key={i} grid />
      ))}
    </div>
  );
}

/**
 * The grouped results (#502): one tile per neighborhood. Each tile shows a name, a place, live
 * photos and counts. Nothing ranks or describes a neighborhood.
 */
export default function NeighborhoodGroupGrid({
  rows,
  hrefFor,
  onSelect,
}: {
  rows: readonly NeighborhoodRow[];
  /** The listings link for a row, used for new-tab and copy-link. */
  hrefFor: (row: NeighborhoodRow, listingType?: 'sale' | 'rent') => string;
  onSelect: (row: NeighborhoodRow, listingType?: 'sale' | 'rent') => void;
}) {
  return (
    <div className={GROUP_GRID_CLASS} data-testid="neighborhood-group-grid">
      {rows.map((row) => (
        <NeighborhoodTile
          key={row.key}
          n={toNeighborhood(row)}
          grid
          hrefFor={(type) => hrefFor(row, type)}
          onSelect={(type) => onSelect(row, type)}
        />
      ))}
    </div>
  );
}
