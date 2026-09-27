import { z } from 'zod';
import { consumerStatusSchema, idSchema, listingTypeSchema } from './common';
import { searchRequestSchema } from './search-request';

/** Above this many mappable listings in the viewport, `GET /listings/map` returns clusters. */
export const MAP_PIN_THRESHOLD_DEFAULT = 500;

export const MAP_ZOOM_MAX = 22;

/** `west,south,east,north` in degrees. The antimeridian is out of scope for this market. */
const mapBounds = z
  .string()
  .regex(/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/, 'must be four numbers: west,south,east,north')
  .transform((value) => {
    const [west, south, east, north] = value.split(',').map(Number) as [
      number,
      number,
      number,
      number,
    ];
    return { west, south, east, north };
  })
  .pipe(
    z
      .object({
        west: z.number().min(-180).max(180),
        south: z.number().min(-90).max(90),
        east: z.number().min(-180).max(180),
        north: z.number().min(-90).max(90),
      })
      .refine((b) => b.west < b.east && b.south < b.north, 'west < east and south < north'),
  )
  .describe(
    'Viewport as `west,south,east,north` in decimal degrees. West must be less than east and ' +
      'south less than north.',
  );

const mapZoom = z
  .string()
  .regex(/^(\d|1\d|2[0-2])$/, `must be a whole number from 0 to ${MAP_ZOOM_MAX}`)
  .transform(Number)
  .pipe(z.number().int().min(0).max(MAP_ZOOM_MAX))
  .describe(`Web-map zoom level, 0 to ${MAP_ZOOM_MAX}. Sets the cluster cell size.`);

/**
 * The search filters, minus paging and sort, plus the viewport. Derived from
 * `searchRequestSchema` so the map and the list accept the same filters. Strict, like search.
 */
export const mapRequestSchema = searchRequestSchema
  .omit({ sort: true, page: true, pageSize: true })
  .extend({ bounds: mapBounds, zoom: mapZoom });

export type MapRequestInput = z.input<typeof mapRequestSchema>;
export type MapRequest = z.output<typeof mapRequestSchema>;
export type MapBounds = MapRequest['bounds'];

/** Only the fields a price pin needs. No address, no attribution: the pin is not a card. */
export const mapPinSchema = z.object({
  id: idSchema,
  latitude: z.number(),
  longitude: z.number(),
  price: z.number().nullable(),
  status: consumerStatusSchema,
  /** Sets the pin label format (`$2.5k` for rent, `$450k` for sale). */
  listingType: listingTypeSchema,
});

export const mapClusterSchema = z.object({
  count: z.number().int().positive(),
  latitude: z.number(),
  longitude: z.number(),
  bounds: z.object({
    west: z.number(),
    south: z.number(),
    east: z.number(),
    north: z.number(),
  }),
});

/**
 * `count` is the number of mappable listings in the viewport. A listing whose seller withheld the
 * address has no coordinates, so it is in no pin, no cluster and no `count`.
 * `sampleCount` is how many of those are sample data, for the map's disclosure banner.
 */
export const mapResponseSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('pins'),
    count: z.number().int().nonnegative(),
    sampleCount: z.number().int().nonnegative(),
    pins: z.array(mapPinSchema),
  }),
  z.object({
    kind: z.literal('clusters'),
    count: z.number().int().nonnegative(),
    sampleCount: z.number().int().nonnegative(),
    clusters: z.array(mapClusterSchema),
  }),
]);

export type MapPin = z.infer<typeof mapPinSchema>;
export type MapCluster = z.infer<typeof mapClusterSchema>;
export type MapResponse = z.infer<typeof mapResponseSchema>;
