import { collapseCondition, DISABLE_JIT_SQL } from '../listings/collapse';
import { LISTING_CARD_SELECT } from '../listings/columns';
import { type ListingCardDbRow, toListingCardRow } from '../listings/map-row';
import {
  CARD_UNIT_NUMBER,
  mediaVisibleSql,
  PRICE_CHANGE_JOIN,
  PRIMARY_MEDIA_ORDER,
  type ReadClient,
  type ReadPool,
} from '../listings/repository';
import { applyCardAddressSuppression } from '../listings/suppression';
import type { Candidate } from './ranker/features';
import {
  CANDIDATE_LIMIT,
  EXTRA_CANDIDATE_LIMIT,
  PHOTO_FULL_COUNT,
  STATEMENT_TIMEOUT_MS,
} from './ranker/v1-weights';

/**
 * The candidate query of the home feed (#835). It reads `listing_search_v`, so every visibility,
 * address, price and photo suppression applies. The columns are the search card's plus the facts
 * below. The Fair Housing test scans `FEED_EXTRA_COLUMNS` and `LISTING_CARD_SELECT`.
 */
export const FEED_EXTRA_COLUMNS = [
  'pm.primary_media_url',
  'pm.primary_media_alt_text',
  'pm.media_is_primary',
  'pm.photo_count',
  'pc.previous_price',
  'pc.price_changed_at',
  'pop.score AS pop_score',
  'ids.dist_km',
] as const;

export interface FeedCandidateRow extends ListingCardDbRow {
  media_is_primary: boolean | null;
  photo_count: number | null;
  pop_score: number | null;
  dist_km: number | null;
}

export interface Centre {
  readonly lat: number;
  readonly lng: number;
}

export interface CandidateQuery {
  readonly side: 'sale' | 'rent';
  readonly city: string;
  readonly state: string;
  readonly centre: Centre | null;
  /** Null means the whole state. */
  readonly radiusKm: number | null;
}

const KM_PER_DEGREE = 111;

/** The bounding box of the radius, padded 10%. The coordinate index prunes with it first. */
export function boundingBox(
  centre: Centre,
  radiusKm: number,
): { south: number; north: number; west: number; east: number } {
  const dLat = (radiusKm * 1.1) / KM_PER_DEGREE;
  const cos = Math.max(0.01, Math.cos((centre.lat * Math.PI) / 180));
  const dLng = (radiusKm * 1.1) / (KM_PER_DEGREE * cos);
  return {
    south: centre.lat - dLat,
    north: centre.lat + dLat,
    west: centre.lng - dLng,
    east: centre.lng + dLng,
  };
}

const MEDIA_VISIBLE = mediaVisibleSql('v');

const PRIMARY_MEDIA_JOIN = `
    LEFT JOIN LATERAL (
      SELECT m.source_url AS primary_media_url, m.alt_text AS primary_media_alt_text,
             m.is_primary AS media_is_primary,
             (SELECT count(*)::int FROM (
                SELECT 1 FROM listing_media m2
                WHERE m2.listing_id = v.id AND m2.source_url IS NOT NULL
                  AND (v.media_display_allowed OR m2.retained_when_suppressed)
                LIMIT ${PHOTO_FULL_COUNT}) capped) AS photo_count
      FROM listing_media m
      WHERE m.listing_id = v.id AND m.source_url IS NOT NULL AND ${MEDIA_VISIBLE}
      ORDER BY ${PRIMARY_MEDIA_ORDER}
      LIMIT 1
    ) pm ON true`;

const FALLBACK_LIMIT = 100;

const OUTER_SELECT = `SELECT ${LISTING_CARD_SELECT}, ${FEED_EXTRA_COLUMNS.join(', ')}, ${CARD_UNIT_NUMBER}
    FROM ids
    JOIN listing_search_v v ON v.id = ids.id${PRIMARY_MEDIA_JOIN}${PRICE_CHANGE_JOIN}
    LEFT JOIN listing_popularity_14d pop ON pop.listing_id = v.id`;

/** Builds the statement and its parameters. Exported for the plan test. */
export function buildCandidateSql(query: CandidateQuery): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  const conditions = [
    `v.listing_type = ${bind(query.side)}`,
    `v.status = ANY(${bind(['Active', 'Coming Soon'])})`,
    `EXISTS (SELECT 1 FROM listing_media m WHERE m.listing_id = v.id
               AND m.source_url IS NOT NULL AND ${MEDIA_VISIBLE})`,
  ];
  let distance = 'NULL::double precision';
  if (query.centre !== null) {
    const point = `ST_SetSRID(ST_MakePoint(${bind(query.centre.lng)}::double precision, ${bind(query.centre.lat)}::double precision), 4326)::geography`;
    distance = `ST_Distance(v.geog, ${point}) / 1000.0`;
    if (query.radiusKm !== null) {
      const box = boundingBox(query.centre, query.radiusKm);
      conditions.push(
        `v.latitude BETWEEN ${bind(box.south)} AND ${bind(box.north)}
         AND v.longitude BETWEEN ${bind(box.west)} AND ${bind(box.east)}
         AND ST_DWithin(v.geog, ${point}, ${bind(query.radiusKm * 1000)})`,
      );
    }
  }
  if (query.radiusKm === null) {
    conditions.push(`lower(v.state) = lower(${bind(query.state)})`);
  }
  conditions.push(collapseCondition());
  const where = conditions.join('\n      AND ');

  const pick = (extra: string, order: string, limit: number): string =>
    `SELECT v.id, ${distance} AS dist_km FROM listing_search_v v
     WHERE ${where}${extra}
     ORDER BY ${order} LIMIT ${limit}`;

  const text = `
    WITH base AS MATERIALIZED (${pick('', 'v.last_updated DESC, v.id DESC', CANDIDATE_LIMIT)}),
    drops AS MATERIALIZED (${pick(' AND v.price_reduced', 'v.last_updated DESC, v.id DESC', EXTRA_CANDIDATE_LIMIT)}),
    fresh AS MATERIALIZED (${pick(' AND v.listed_at IS NOT NULL', 'v.listed_at DESC, v.id DESC', EXTRA_CANDIDATE_LIMIT)}),
    ids AS (
      SELECT id, min(dist_km) AS dist_km FROM (
        SELECT * FROM base UNION ALL SELECT * FROM drops UNION ALL SELECT * FROM fresh
      ) u GROUP BY id
    )
    ${OUTER_SELECT}`;
  return { text, params };
}

/**
 * The degraded read (#835). It starts from the small popularity view, so it stays cheap when the
 * personalised query times out. Same visibility, collapse and photo rules. No personal signal.
 */
export function buildFallbackSql(query: { side: 'sale' | 'rent'; state: string }): {
  text: string;
  params: unknown[];
} {
  const params = [query.side, ['Active', 'Coming Soon'], query.state];
  const text = `
    WITH ids AS (
      SELECT v.id, NULL::double precision AS dist_km
      FROM listing_popularity_14d pop
      JOIN listing_search_v v ON v.id = pop.listing_id
      WHERE v.listing_type = $1 AND v.status = ANY($2) AND lower(v.state) = lower($3)
        AND EXISTS (SELECT 1 FROM listing_media m WHERE m.listing_id = v.id
                      AND m.source_url IS NOT NULL AND ${MEDIA_VISIBLE})
        AND ${collapseCondition()}
      ORDER BY pop.score DESC, v.id
      LIMIT ${FALLBACK_LIMIT}
    )
    ${OUTER_SELECT}`;
  return { text, params };
}

export function toCandidate(row: FeedCandidateRow): Candidate {
  return {
    card: applyCardAddressSuppression(toListingCardRow(row)),
    distanceKm: row.dist_km === null ? null : Number(row.dist_km),
    photoCount: Number(row.photo_count ?? 0),
    hasPreferredPhoto: row.media_is_primary === true,
    popularity: Number(row.pop_score ?? 0),
  };
}

interface CentreCacheEntry {
  readonly centre: Centre | null;
  readonly at: number;
}
const CENTRE_TTL_MS = 6 * 60 * 60 * 1000;
/** A city with no visible coordinates is checked again soon, in case it gains listings. */
const CENTRE_MISS_TTL_MS = 60_000;
const CENTRE_CACHE_MAX = 500;
const centreCache = new Map<string, CentreCacheEntry>();

export function clearCentreCache(): void {
  centreCache.clear();
}

/**
 * The mean of up to 200 visible coordinates of the city. A bounded read, and the answer changes
 * slowly, so it is cached in the process.
 */
async function resolveCentre(
  client: { query<T>(text: string, values?: unknown[]): Promise<{ rows: T[] }> },
  city: string,
  state: string,
  now: number,
): Promise<Centre | null> {
  const key = `${city.toLowerCase()}|${state.toLowerCase()}`;
  const hit = centreCache.get(key);
  if (
    hit !== undefined &&
    now - hit.at < (hit.centre === null ? CENTRE_MISS_TTL_MS : CENTRE_TTL_MS)
  ) {
    return hit.centre;
  }
  const { rows } = await client.query<{ lat: number | null; lng: number | null }>(
    `SELECT avg(t.latitude)::double precision AS lat, avg(t.longitude)::double precision AS lng
     FROM (SELECT v.latitude, v.longitude FROM listing_search_v v
           WHERE lower(v.city) = lower($1) AND lower(v.state) = lower($2)
             AND v.latitude IS NOT NULL AND v.longitude IS NOT NULL
           ORDER BY v.id
           LIMIT 200) t`,
    [city, state],
  );
  const row = rows[0];
  const centre =
    row && row.lat !== null && row.lng !== null
      ? { lat: Number(row.lat), lng: Number(row.lng) }
      : null;
  if (centreCache.size >= CENTRE_CACHE_MAX) centreCache.clear();
  centreCache.set(key, { centre, at: now });
  return centre;
}

/**
 * One read-only transaction with a statement timeout. The radius uses the coordinate index
 * (migration 036) through a bounding box, then `ST_DWithin` for the exact test. No exact count runs.
 */
export async function findFeedCandidates(
  pool: ReadPool,
  query: Omit<CandidateQuery, 'centre'> & { centre?: Centre | null },
  now: number,
): Promise<Candidate[]> {
  return withReadTimeout(pool, async (client) => {
    const centre = query.centre ?? (await resolveCentre(client, query.city, query.state, now));
    // Whole-state mode needs no centre. Distance is then unknown and the geo feature is 0.
    if (centre === null && query.radiusKm !== null) return [];
    const { text, params } = buildCandidateSql({ ...query, centre });
    const result = await client.query<FeedCandidateRow>(text, params);
    return result.rows.map(toCandidate);
  });
}

/** Popularity-ordered candidates of the state. No centre, no personal signal. */
export async function findFallbackCandidates(
  pool: ReadPool,
  query: { side: 'sale' | 'rent'; state: string },
): Promise<Candidate[]> {
  return withReadTimeout(pool, async (client) => {
    const { text, params } = buildFallbackSql(query);
    const result = await client.query<FeedCandidateRow>(text, params);
    return result.rows.map(toCandidate);
  });
}

/**
 * One read-only transaction on one pooled connection, with the statement timeout every feed read
 * shares (#755). A timeout rejects and rolls back.
 */
export async function withReadTimeout<T>(
  pool: ReadPool,
  work: (client: ReadClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    await client.query(DISABLE_JIT_SQL);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
