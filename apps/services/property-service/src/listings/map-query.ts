import {
  type MapBounds,
  type MapRequest,
  type MapResponse,
  mapResponseSchema,
  PAGE_SIZE_DEFAULT,
  type SearchRequest,
} from '@cribstop/property-contracts';
import { resolvedSearchRequest } from './on-demand';
import type { ReadPool } from './repository';
import { buildSearchQuery } from './search-query';

/** The map filters, as the search request `buildSearchQuery` takes. Paging and sort are unused. */
export function toSearchRequest(request: MapRequest): SearchRequest {
  const { bounds: _bounds, ...filters } = request;
  return resolvedSearchRequest({
    ...filters,
    sort: 'recommended',
    page: 1,
    pageSize: PAGE_SIZE_DEFAULT,
  });
}

interface PinDbRow {
  id: string;
  latitude: number;
  longitude: number;
  price: number | null;
  status: string;
  listing_type: string;
  is_sample: boolean;
}

/**
 * One pin per listing in the viewport, newest first, up to `pinCap`. The map never clusters. The
 * WHERE clause is `buildSearchQuery`'s, so the map set is always the list set limited to the
 * viewport.
 *
 * The viewport reads the view's masked `latitude`/`longitude`. A row with a withheld address has
 * NULL there, fails the range test, and so is in no pin and not in `total`.
 *
 * The count query runs only when the pin query fills the cap. A smaller result is the whole set,
 * so `total` is the row count and a normal viewport costs one bounded read.
 */
export async function findMapPins(
  pool: ReadPool,
  request: MapRequest,
  pinCap: number,
): Promise<MapResponse> {
  const { where, params } = buildSearchQuery(toSearchRequest(request));
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };
  const inBounds = (b: MapBounds): string =>
    `v.latitude BETWEEN ${bind(b.south)} AND ${bind(b.north)}
     AND v.longitude BETWEEN ${bind(b.west)} AND ${bind(b.east)}`;

  const client = await pool.connect();
  try {
    // One snapshot for both statements, the same reason as `searchListings`.
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');

    const viewportWhere = `${where}\n  AND ${inBounds(request.bounds)}`;
    const boundParams = params.length;
    const pinResult = await client.query<PinDbRow>(
      `SELECT v.id, v.latitude, v.longitude, v.price, v.status, v.listing_type, v.is_sample
       FROM listing_search_v v
       WHERE ${viewportWhere}
       ORDER BY v.last_updated DESC, v.id DESC
       LIMIT ${bind(pinCap)}`,
      [...params],
    );

    let total = pinResult.rows.length;
    if (total >= pinCap) {
      const countResult = await client.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM listing_search_v v WHERE ${viewportWhere}`,
        params.slice(0, boundParams),
      );
      total = Number(countResult.rows[0]?.total ?? total);
    }
    await client.query('COMMIT');

    // The contract parse rejects a status or type outside its enums instead of sending it.
    return mapResponseSchema.parse({
      total,
      sampleCount: pinResult.rows.filter((row) => row.is_sample).length,
      pins: pinResult.rows.map((row) => ({
        id: row.id,
        latitude: row.latitude,
        longitude: row.longitude,
        price: row.price === null ? null : Number(row.price),
        status: row.status,
        listingType: row.listing_type,
      })),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
