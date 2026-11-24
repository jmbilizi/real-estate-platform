/**
 * The listing detail layout (2026-11-24): flat sections on a white ground, divided by hairlines.
 * No section is a bordered box. The loaded page and its skeleton both read these, so the two
 * states cannot drift.
 */

/** The scrolling body. White, with the page gutter. */
export const DETAIL_BODY = 'scrollbar-overlay min-h-0 flex-1 bg-white page-gutter pb-8';

/** The gallery. Edge to edge on a phone, with round corners from `sm`. No border. */
export const DETAIL_GALLERY = '-mx-4 overflow-hidden sm:mx-0 sm:mt-4 sm:rounded-2xl';

/** Main column and sidebar. */
export const DETAIL_GRID =
  'grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-x-12';

/** One flat section: padding above and below, a hairline under it. */
export const DETAIL_SECTION = 'border-b border-surface-border py-6 sm:py-8';

/**
 * The one card on the page: the agent blocks in the sidebar, from `lg` only. Below `lg` its
 * children are flat sections like every other.
 */
export const DETAIL_ASIDE_CARD =
  'lg:rounded-2xl lg:border lg:border-surface-border lg:px-6 lg:shadow-[0_6px_16px_rgba(0,0,0,0.12)] lg:[&>*:last-child]:border-b-0';

/** The sidebar column. Its last section has no hairline from `lg`. */
export const DETAIL_ASIDE =
  'lg:sticky lg:top-24 lg:mt-8 lg:self-start lg:[&>*:last-child]:border-b-0';
