import { z } from 'zod';
import { consumerStatusSchema, idSchema, listingTypeSchema } from './common';
import { searchRequestSchema } from './search-request';

/**
 * The most pins one `GET /listings/map` response carries. A viewport with more homes gets the
 * newest ones, and `total` says how many there are. The map never groups homes into clusters.
 */
export const MAP_PIN_CAP_DEFAULT = 1800;

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

/**
 * The search filters, minus paging and sort, plus the viewport. Derived from
 * `searchRequestSchema` so the map and the list accept the same filters. Strict, like search.
 */
export const mapRequestSchema = searchRequestSchema
  .omit({ sort: true, page: true, pageSize: true })
  .extend({ bounds: mapBounds });

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
  /** Sets the pin label format (`/mo` suffix for rent). */
  listingType: listingTypeSchema,
});

/**
 * `total` is the number of mappable listings in the viewport. `pins` holds the newest of them, up
 * to the cap, so `pins.length < total` means the viewport is over the cap. A listing whose seller
 * withheld the address has no coordinates, so it is in no pin and not in `total`.
 * `sampleCount` is how many of `pins` are sample data, for the map's disclosure banner.
 */
export const mapResponseSchema = z.object({
  total: z.number().int().nonnegative(),
  sampleCount: z.number().int().nonnegative(),
  pins: z.array(mapPinSchema),
});

export type MapPin = z.infer<typeof mapPinSchema>;
export type MapResponse = z.infer<typeof mapResponseSchema>;
