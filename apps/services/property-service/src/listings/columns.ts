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

/**
 * #390. `listing_search_v`'s row-visibility predicate (migration
 * `1785801600011_replace-listing-search-view-suppress-free-text.js`), duplicated ONLY here and
 * ONLY for performance.
 *
 * `getNeighborhoods()` in `repository.ts` aggregates over `listings` directly with this predicate,
 * instead of reading `listing_search_v` the way every other query in this file does. Going through
 * the view pulls in its INNER JOIN to `properties` and its LATERAL open-house join for every
 * candidate row — needed for the view's OTHER columns, never for this aggregate's `COUNT` — and
 * measured at 1-3 seconds for a populous state (MD, VA) against the real dataset, well past the
 * 300ms budget. Reading `listings` directly with just this predicate measures under 100ms for the
 * same states.
 *
 * `listing-search-view.spec.ts`'s "the neighborhoods predicate duplicate" block asserts this
 * string's four conditions are still substrings of the view's actual WHERE clause, resolved from
 * the newest view migration the same way every other guard in that file is. A future suppression
 * rule added to the view and missed here fails that test loudly instead of silently letting this
 * aggregate count a listing the view would have excluded.
 */
export const LISTING_VISIBILITY_SQL = `
  l.deleted_at IS NULL
  AND l.internet_display_allowed
  AND l.consumer_status IS NOT NULL
  AND (l.consumer_status <> 'Sold' OR l.close_date IS NOT NULL)
`;

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
  // #53. Bright's field-level suppression predicate inputs that mask a VALUE in the view. A
  // handler reading one of these is a handler that can re-implement a rule the view already
  // enforces. `media_display_allowed` is a DELIBERATE exception, listed separately below: it masks
  // no view column, so barring it from a projection would forbid nothing real.
  'price_display_allowed',
  'price_history_display_allowed',
  'days_on_market_display_allowed',
  // `media_display_allowed` gates repository.ts's ad hoc media-join SQL, not a CARD/DETAIL
  // projection — it never reaches `LISTING_CARD_COLUMNS`, so listing it in the array above would
  // assert something this file cannot fail on. Named here so a reader auditing the five #53 flags
  // finds all of them from this one file.
  'media_display_allowed',
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
  // #53. Nullable when the seller suppressed days-on-market display.
  'days_on_market',
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

/** #349. `listing_detail_v`: the address and the property record, in any market status. */
const PROPERTY_RECORD_COLUMNS = [
  'id',
  'property_id',
  'unit_id',
  'listing_data_displayable',
  'market_status',
  'address_street',
  'unit_number',
  'city',
  'state',
  'zip',
  'property_type',
  'beds',
  'baths',
  'sqft',
  'lot_sqft',
  'year_built',
  'source',
  'is_sample',
  'last_updated',
] as const;

export const PROPERTY_RECORD_SELECT = PROPERTY_RECORD_COLUMNS.map((column) => `d.${column}`).join(
  ', ',
);

/**
 * The governed MLS attribute path (#127/#128). `listing_attributes`/`property_attributes` are
 * unreachable from `listing_search_v`, so every read joins `mls_fields` for `address_classification`
 * — whether a value can re-identify a suppressed address is a property of the FIELD, never of one
 * instance of it. Enumerated for the same reason as the columns above: no `SELECT *` on a table that
 * will eventually carry a few hundred distinct fields.
 */
const ATTRIBUTE_VALUE_COLUMNS = [
  'a.id',
  'a.field_id',
  'a.value_kind',
  'a.value_numeric',
  'a.value_boolean',
  'a.value_date',
  'a.value_timestamp',
  'a.value_lookup_id',
] as const;

const ATTRIBUTE_FIELD_COLUMNS = [
  'f.originating_system',
  'f.reso_resource',
  'f.field_name',
  'f.address_classification',
  'f.is_consumer_displayable',
] as const;

export const ATTRIBUTE_SELECT = [...ATTRIBUTE_VALUE_COLUMNS, ...ATTRIBUTE_FIELD_COLUMNS].join(', ');
