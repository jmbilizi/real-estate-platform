/**
 * The enumerated read-model projections. There is deliberately no `SELECT *` anywhere in this
 * service.
 *
 * `listing_search_v` no longer projects the unmasked `street_line` at all (#48, closed by migration
 * `1785801600010_replace-listing-search-view-drop-street-line.js`), so enumerating is no longer the
 * only thing standing between a suppressed address and this process. It stays anyway: the view
 * still projects the compliance predicate inputs below, `SELECT *` would silently pick up whatever
 * a future migration adds, and defence in depth on a seller opt-out is worth one line per column.
 */

/** Columns that must never appear in a projection, with the reason each one is barred. */
export const FORBIDDEN_COLUMNS = [
  // #48: the raw street line. The view no longer exposes it, and this entry is what keeps a future
  // migration from re-adding it and a projection from picking it up — reading it at all would put a
  // seller-suppressed address into this process's memory and its query logs.
  'street_line',
  // The view's own compliance predicate inputs. A handler that reads them is a handler that can be
  // tempted to re-implement the rule instead of trusting the view.
  'address_display_allowed',
  'internet_display_allowed',
  'description_moderation',
  'source_status',
] as const;

const CARD_COLUMNS = [
  'id',
  'property_id',
  'unit_id',
  'title',
  'address',
  'city',
  'state',
  'zip',
  'neighborhood',
  'latitude',
  'longitude',
  'price',
  'status',
  'listing_type',
  'source',
  'property_type',
  'beds',
  'baths',
  'sqft',
  'lot_sqft',
  'year_built',
  'amenities',
  'featured',
  'featured_reason',
  'price_reduced',
  'new_construction',
  'is_sample',
  'close_price',
  'close_date',
  'last_updated',
  'listing_agent_name',
  'broker_name',
  'broker_phone',
  'broker_email',
  'office_name',
  'office_broker_lead_phone',
  'office_broker_lead_email',
  'listed_by',
  'open_house_starts_at',
  'open_house_ends_at',
  'open_house_remarks',
] as const;

export const LISTING_CARD_COLUMNS: readonly string[] = CARD_COLUMNS;

const qualify = (columns: readonly string[]): string =>
  columns.map((column) => `v.${column}`).join(', ');

export const LISTING_CARD_SELECT = qualify(CARD_COLUMNS);

/**
 * Detail adds `description` — the ONLY place it appears. It is third-party MLS remarks carrying a
 * moderation state (the view withholds unapproved copy), and it is the field with the most Fair
 * Housing steering risk, so it does not belong on the widest and most-cached surface.
 */
export const LISTING_DETAIL_SELECT = `${LISTING_CARD_SELECT}, v.description`;
