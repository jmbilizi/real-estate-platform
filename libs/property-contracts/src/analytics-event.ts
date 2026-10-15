import { z } from 'zod';
import { idSchema } from './common';

/**
 * Analytics event contract, version 2 (#824). One contract for the whole product. It names no
 * analytics tool. Any sink reads the same normalized event.
 *
 * To add an event, see `apps/services/property-service/docs/funnel-analytics.md`: add one entry to
 * `EVENT_PROPS` below. No migration is needed, because event-specific values live in a JSON column.
 *
 * Every event is a strict object. An unknown event or property is a 400. No property holds free
 * text, a name, an email or a phone number. The one exception is `query_text` on
 * `search_zero_result_text`, which `scrubQueryText` cleans. The server stamps the UTC time.
 */
export const ANALYTICS_CONTRACT_VERSION = 2;

export const ANALYTICS_SURFACES = ['search', 'map', 'detail', 'favorites', 'home', 'auth'] as const;
export const analyticsSurfaceSchema = z.enum(ANALYTICS_SURFACES);
export type AnalyticsSurface = z.infer<typeof analyticsSurfaceSchema>;

export const ANALYTICS_DEVICES = ['mobile', 'tablet', 'desktop'] as const;

/** `ui_click` accepts only these ids, so a click never carries element text. */
export const UI_CLICK_ELEMENT_IDS = [
  'header_search',
  'header_sign_in',
  'footer_analytics_opt_out',
  'filter_open',
  'sort_change',
  'map_toggle',
  'list_toggle',
  'save_search',
  'share_open',
  'tour_cta',
  'contact_cta',
] as const;

export const DWELL_BUCKETS = ['0-5', '5-30', '30-120', '120+'] as const;

const key = z.string().regex(/^[A-Za-z0-9_.:-]{1,60}$/);
const count = z.number().int().min(0).max(1_000_000);
const flag = z.boolean();
const pathTemplate = z.string().regex(/^\/[A-Za-z0-9_\-/[\].]{0,119}$/);
const hostName = z.string().regex(/^[a-z0-9]([a-z0-9.-]{0,98}[a-z0-9])?$/);
const utmValue = z.string().regex(/^[a-z0-9_.-]{1,64}$/);
/** `home:{rowId}:{position}`, set on a listing URL that a home-feed card opens. */
const feedSource = z.string().regex(/^home:[A-Za-z0-9_.-]{1,40}:\d{1,3}$/);

/** A grid cell of about 1 km: latitude and longitude with 2 decimals. Never an exact point. */
const bboxCell = z.string().regex(/^-?\d{1,3}\.\d{2}:-?\d{1,3}\.\d{2}$/);

const searchFilters = z.strictObject({
  type: key.optional(),
  price_min: count.optional(),
  price_max: count.optional(),
  beds: count.max(20).optional(),
  baths: count.max(20).optional(),
  area_key: key.optional(),
});

/** Properties held in their own columns. Every other property goes to the JSON column. */
export const ANALYTICS_COLUMN_PROPS = [
  'anon_id',
  'path_template',
  'device',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'referrer_host',
  'app_version',
  'listing_id',
  'row_id',
  'query_text',
] as const;

const COMMON = {
  surface: analyticsSurfaceSchema,
  session_id: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,64}$/)
    .optional(),
  /** The #725 spelling of `session_id`. Accepted so old clients keep working. */
  sessionId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,64}$/)
    .optional(),
  /** The #725 spelling of `listing_id`. */
  listingId: idSchema.optional(),
  anon_id: z
    .string()
    .regex(/^[A-Za-z0-9_-]{16,64}$/)
    .optional(),
  path_template: pathTemplate.optional(),
  device: z.enum(ANALYTICS_DEVICES).optional(),
  utm_source: utmValue.optional(),
  utm_medium: utmValue.optional(),
  utm_campaign: utmValue.optional(),
  referrer_host: hostName.optional(),
  app_version: z
    .string()
    .regex(/^[A-Za-z0-9._+-]{1,32}$/)
    .optional(),
};

const listing = { listing_id: idSchema.optional() };
const feedFields = {
  row_id: key,
  position: count.max(200),
  listing_id: idSchema,
  variant: key,
  model_version: key,
  explore: flag,
};
const lead = {
  ...listing,
  form_type: z.enum(['tour', 'info']).optional(),
  step: key.optional(),
  error_code: key.optional(),
};
const auth = {
  method: key.optional(),
  entry_point: key.optional(),
  is_new_account: flag.optional(),
  error_code: key.optional(),
};
const errorFields = {
  code: key.optional(),
  route_template: pathTemplate.optional(),
  http_status: z.number().int().min(100).max(599).optional(),
  component_key: key.optional(),
};

/**
 * The only table to edit when you add an event. Each value lists the properties the event accepts
 * on top of the common ones. Anything else is rejected.
 */
export const EVENT_PROPS = {
  // Legacy #725 events keep their shape.
  listing_view: { ...listing },
  page_view: { title_key: key.optional() },
  session_start: { landing_path: pathTemplate.optional(), is_new_anon: flag.optional() },
  listing_impression: {
    ...listing,
    row_id: key.optional(),
    row_position: count.max(200).optional(),
    card_position: count.max(200).optional(),
    list_type: z.enum(['grid', 'map', 'favorites', 'similar']).optional(),
    rank_algo: key.optional(),
    rank_score: z.number().min(0).max(1).optional(),
  },
  listing_click: {
    ...listing,
    row_id: key.optional(),
    card_position: count.max(200).optional(),
    target: z.enum(['card', 'photo', 'cta']).optional(),
  },
  ui_click: { element_id: z.enum(UI_CLICK_ELEMENT_IDS) },
  dwell: {
    ...listing,
    active_ms: count.max(86_400_000).optional(),
    scroll_depth_pct: count.max(100).optional(),
    dwell_bucket: z.enum(DWELL_BUCKETS).optional(),
  },
  search: {
    filters: searchFilters.optional(),
    sort: key.optional(),
    result_count: count.optional(),
    is_zero_result: flag.optional(),
    source: z.enum(['box', 'filter', 'map', 'saved']).optional(),
  },
  search_zero_result_text: { query_text: z.string().max(200) },
  map_move: {
    zoom: count.max(22).optional(),
    bbox_cell: bboxCell,
    result_count: count.optional(),
    trigger: z.enum(['pan', 'zoom', 'draw']).optional(),
  },
  listing_save: { ...listing, src: feedSource.optional() },
  listing_unsave: { ...listing },
  listing_share: { ...listing, channel: z.enum(['copy', 'sms', 'email', 'native']).optional() },
  lead_open: { ...lead },
  lead_start: { ...lead },
  lead_submit: { ...lead, src: feedSource.optional() },
  lead_error: { ...lead },
  auth_identify_shown: { ...auth },
  auth_code_sent: { ...auth },
  auth_code_verified: { ...auth },
  auth_signup_done: { ...auth },
  auth_fail: { ...auth },
  client_error: { ...errorFields },
  api_error: { ...errorFields },
  feed_impression: { ...feedFields },
  feed_click: { ...feedFields },
} satisfies Record<string, z.ZodRawShape>;

export type AnalyticsEventName = keyof typeof EVENT_PROPS;
export const ANALYTICS_EVENT_NAMES = Object.keys(EVENT_PROPS) as [
  AnalyticsEventName,
  ...AnalyticsEventName[],
];
export const analyticsEventNameSchema = z.enum(ANALYTICS_EVENT_NAMES);

/** Removes e-mail addresses, links and digit runs, then limits the text to 60 characters. */
export function scrubQueryText(raw: string): string {
  return raw
    .replace(/[^\s@]+@[^\s@]+/g, ' ')
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
    .replace(/\+?\d[\d\s().-]{4,}\d/g, ' ')
    .replace(/\d{5,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim();
}

function variant(name: AnalyticsEventName) {
  return z
    .strictObject({ event: z.literal(name), ...COMMON, ...EVENT_PROPS[name] })
    .refine((v) => Boolean(v.session_id ?? v.sessionId), {
      message: 'session_id is required.',
      path: ['session_id'],
    })
    .refine(
      (v) =>
        name !== 'search_zero_result_text' ||
        scrubQueryText(String((v as Record<string, unknown>)['query_text'] ?? '')) !== '',
      { message: 'query_text is empty after scrubbing.', path: ['query_text'] },
    );
}

type Variant = ReturnType<typeof variant>;
/**
 * `POST /analytics/events` body. A strict union keyed on `event`, so each event accepts only its
 * own properties. A #725 body (`sessionId`, `listingId`) still passes.
 */
export const analyticsEventRequestSchema = z.discriminatedUnion(
  'event',
  ANALYTICS_EVENT_NAMES.map(variant) as unknown as [Variant, ...Variant[]],
);
export type AnalyticsEventRequest = z.infer<typeof analyticsEventRequestSchema>;

/** One request may carry many events, so impressions fit the gateway rate limit. The body is one event or an array of up to 50. */
export const ANALYTICS_BATCH_MAX = 50;
export const analyticsEventBatchSchema = z
  .array(analyticsEventRequestSchema)
  .min(1)
  .max(ANALYTICS_BATCH_MAX);

/** The shape every sink receives. Column properties are top-level. The rest are in `props`. */
export interface NormalizedAnalyticsEvent {
  version: typeof ANALYTICS_CONTRACT_VERSION;
  event: AnalyticsEventName;
  surface: AnalyticsSurface;
  sessionId: string;
  anonId: string | null;
  listingId: string | null;
  rowId: string | null;
  queryText: string | null;
  common: Partial<
    Record<
      | 'path_template'
      | 'device'
      | 'utm_source'
      | 'utm_medium'
      | 'utm_campaign'
      | 'referrer_host'
      | 'app_version',
      string
    >
  >;
  props: Record<string, unknown>;
}

const COMMON_COLUMNS = [
  'path_template',
  'device',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'referrer_host',
  'app_version',
] as const;
const HANDLED = new Set<string>([
  'event',
  'surface',
  'session_id',
  'sessionId',
  'listingId',
  ...ANALYTICS_COLUMN_PROPS,
]);

export function normalizeAnalyticsEvent(input: AnalyticsEventRequest): NormalizedAnalyticsEvent {
  const raw = input as Record<string, unknown>;
  const str = (name: string): string | null =>
    typeof raw[name] === 'string' ? (raw[name] as string) : null;
  const common: NormalizedAnalyticsEvent['common'] = {};
  for (const name of COMMON_COLUMNS) {
    const value = str(name);
    if (value !== null) common[name] = value;
  }
  const props: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (!HANDLED.has(name) && value !== undefined) props[name] = value;
  }
  const query = str('query_text');
  return {
    version: ANALYTICS_CONTRACT_VERSION,
    event: input.event,
    surface: input.surface,
    sessionId: (str('session_id') ?? str('sessionId')) as string,
    anonId: str('anon_id'),
    listingId: str('listing_id') ?? str('listingId'),
    rowId: str('row_id'),
    queryText: query === null ? null : scrubQueryText(query),
    common,
    props,
  };
}
