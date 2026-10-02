/**
 * Columns of the search results grids (#517). The listing grid and the neighborhood grid both
 * import this, so a neighborhood card and a listing card show the same cards per row.
 */
export const RESULTS_GRID_COLUMNS_CLASS = 'grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3';

/** Gap of the same grids (#519, #526). 16px between rows on a phone. Both grids import it. */
export const RESULTS_GRID_GAP_CLASS = 'gap-8 gap-y-4 sm:gap-y-12';
