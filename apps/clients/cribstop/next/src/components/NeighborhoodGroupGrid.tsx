import type { NeighborhoodRow } from '@cribstop/property-contracts';
import NeighborhoodCard, { NeighborhoodCardSkeleton } from '@/components/NeighborhoodCard';
import {
  RESULTS_GRID_COLUMNS_CLASS,
  RESULTS_GRID_GAP_CLASS,
} from '@/components/resultsGridColumns';
import { toNeighborhood } from '@/lib/neighborhoods';

/** Same columns (#517) and gap (#519) as the listing grid. */
const GROUP_GRID_CLASS = `grid ${RESULTS_GRID_GAP_CLASS} ${RESULTS_GRID_COLUMNS_CLASS}`;

/** The grid's loading state. Same grid class and tile box as the loaded grid. */
export function NeighborhoodGroupGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className={GROUP_GRID_CLASS} data-testid="neighborhood-group-skeleton" aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <NeighborhoodCardSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * The grouped results (#502): one card per neighborhood. Each card shows a name, a place, live
 * photos and counts. Nothing ranks or describes a neighborhood.
 */
export default function NeighborhoodGroupGrid({
  rows,
  hrefFor,
  onSelect,
  activeKey = null,
  activeSource = null,
  onActive,
}: {
  rows: readonly NeighborhoodRow[];
  /** The listings link for a row, used for new-tab and copy-link. */
  hrefFor: (row: NeighborhoodRow, listingType?: 'sale' | 'rent') => string;
  onSelect: (row: NeighborhoodRow, listingType?: 'sale' | 'rent') => void;
  /** The key of the card or marker the pointer or focus is on (#503). */
  activeKey?: string | null;
  /** Where the active state came from. Only a map marker highlights its card (#540). */
  activeSource?: 'card' | 'map' | null;
  onActive?: (key: string | null) => void;
}) {
  return (
    <div className={GROUP_GRID_CLASS} data-testid="neighborhood-group-grid">
      {rows.map((row) => (
        <NeighborhoodCard
          key={row.key}
          n={toNeighborhood(row)}
          hrefFor={(type) => hrefFor(row, type)}
          onSelect={(type) => onSelect(row, type)}
          sync={onActive && { key: row.key, onActive }}
          highlighted={activeKey === row.key && activeSource === 'map'}
        />
      ))}
    </div>
  );
}
