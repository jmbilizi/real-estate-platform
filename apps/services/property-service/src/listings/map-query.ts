import {
  type MapBounds,
  type MapCluster,
  type MapRequest,
  type MapResponse,
  mapResponseSchema,
  PAGE_SIZE_DEFAULT,
  type SearchRequest,
} from '@cribstop/property-contracts';
import { resolvedSearchRequest } from './on-demand';
import type { ReadPool } from './repository';
import { buildSearchQuery } from './search-query';

/** Target cluster cell width on screen. One 256px web-map tile holds four cells. */
const CELL_PIXELS = 64;

/** Caps the grid at 60 x 60 cells whatever `bounds` and `zoom` a caller sends. */
const MAX_CELLS_PER_AXIS = 60;

/** The map filters, as the search request `buildSearchQuery` takes. Paging and sort are unused. */
export function toSearchRequest(request: MapRequest): SearchRequest {
  const { bounds: _bounds, zoom: _zoom, ...filters } = request;
  return resolvedSearchRequest({
    ...filters,
    sort: 'recommended',
    page: 1,
    pageSize: PAGE_SIZE_DEFAULT,
  });
}

/** Cell size in degrees for `zoom`, widened so the grid never exceeds the cell cap. */
export function cellSizeFor(bounds: MapBounds, zoom: number): number {
  const zoomCell = (CELL_PIXELS * 360) / (256 * 2 ** zoom);
  const widest = Math.max(bounds.east - bounds.west, bounds.north - bounds.south);
  return Math.max(zoomCell, widest / MAX_CELLS_PER_AXIS);
}

/**
 * Snaps the viewport out to whole cells. A cluster then always covers a whole cell, so a pan does
 * not split a cluster at the viewport edge, and nearby viewports send the same query.
 */
export function snapToCells(bounds: MapBounds, cell: number): MapBounds {
  return {
    west: Math.floor(bounds.west / cell) * cell,
    south: Math.floor(bounds.south / cell) * cell,
    east: Math.ceil(bounds.east / cell) * cell,
    north: Math.ceil(bounds.north / cell) * cell,
  };
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

interface ClusterDbRow {
  count: number;
  sample_count: number;
  latitude: number;
  longitude: number;
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * Pins, or grid clusters above `pinThreshold`. The WHERE clause is `buildSearchQuery`'s, so the
 * map set is always the list set limited to the viewport.
 *
 * The viewport reads the view's masked `latitude`/`longitude`. A row with a withheld address has
 * NULL there, fails the range test, and so is in no pin, no cluster and no count.
 *
 * The pin query asks for `pinThreshold + 1` rows. Only when it fills does the cluster query run,
 * so a small viewport costs one bounded read.
 */
export async function findMapPins(
  pool: ReadPool,
  request: MapRequest,
  pinThreshold: number,
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

    const pinParams = params.length;
    const pinWhere = `${where}\n  AND ${inBounds(request.bounds)}`;
    const pinResult = await client.query<PinDbRow>(
      `SELECT v.id, v.latitude, v.longitude, v.price, v.status, v.listing_type, v.is_sample
       FROM listing_search_v v
       WHERE ${pinWhere}
       LIMIT ${bind(pinThreshold + 1)}`,
      [...params],
    );

    let response: unknown;
    if (pinResult.rows.length <= pinThreshold) {
      await client.query('COMMIT');
      response = {
        kind: 'pins',
        count: pinResult.rows.length,
        sampleCount: pinResult.rows.filter((row) => row.is_sample).length,
        pins: pinResult.rows.map((row) => ({
          id: row.id,
          latitude: row.latitude,
          longitude: row.longitude,
          price: row.price === null ? null : Number(row.price),
          status: row.status,
          listingType: row.listing_type,
        })),
      };
    } else {
      params.length = pinParams;
      const cell = cellSizeFor(request.bounds, request.zoom);
      const snapped = snapToCells(request.bounds, cell);
      const cellParam = bind(cell);
      const clusterResult = await client.query<ClusterDbRow>(
        `SELECT count(*)::int AS count,
                count(*) FILTER (WHERE v.is_sample)::int AS sample_count,
                avg(v.latitude) AS latitude, avg(v.longitude) AS longitude,
                min(v.longitude) AS west, min(v.latitude) AS south,
                max(v.longitude) AS east, max(v.latitude) AS north
         FROM listing_search_v v
         WHERE ${where}
           AND ${inBounds(snapped)}
         GROUP BY floor(v.longitude / ${cellParam}), floor(v.latitude / ${cellParam})`,
        [...params],
      );
      await client.query('COMMIT');
      const clusters: MapCluster[] = clusterResult.rows.map((row) => ({
        count: row.count,
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        bounds: {
          west: Number(row.west),
          south: Number(row.south),
          east: Number(row.east),
          north: Number(row.north),
        },
      }));
      response = {
        kind: 'clusters',
        count: clusters.reduce((total, c) => total + c.count, 0),
        sampleCount: clusterResult.rows.reduce((total, row) => total + row.sample_count, 0),
        clusters,
      };
    }
    // The contract parse rejects a status or type outside its enums instead of sending it.
    return mapResponseSchema.parse(response);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
