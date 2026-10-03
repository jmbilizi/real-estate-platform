import { z } from 'zod';
import { consumerStatusSchema, idSchema, listingTypeSchema } from './common';
import { searchBoundsSchema, searchRequestSchema } from './search-request';

/**
 * The most pins one `GET /listings/map` response carries. A viewport with more homes gets the
 * newest ones, and `total` says how many there are. The map never groups homes into clusters.
 */
export const MAP_PIN_CAP_DEFAULT = 1800;

/**
 * The search filters, minus paging and sort, plus the viewport. Derived from
 * `searchRequestSchema` so the map and the list accept the same filters. Strict, like search.
 */
export const mapRequestSchema = searchRequestSchema
  .omit({ sort: true, page: true, pageSize: true })
  .extend({ bounds: searchBoundsSchema });

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
