import { z } from 'zod';
import { idSchema } from './common';

/** The four funnel steps (#725). */
export const ANALYTICS_EVENT_NAMES = [
  'search',
  'listing_view',
  'listing_save',
  'lead_submit',
] as const;
export const analyticsEventNameSchema = z.enum(ANALYTICS_EVENT_NAMES);
export type AnalyticsEventName = z.infer<typeof analyticsEventNameSchema>;

export const ANALYTICS_SURFACES = ['search', 'map', 'detail', 'favorites'] as const;
export const analyticsSurfaceSchema = z.enum(ANALYTICS_SURFACES);
export type AnalyticsSurface = z.infer<typeof analyticsSurfaceSchema>;

/**
 * `POST /analytics/events` body (#725). Strict: an unknown field is a 400, so no free text, search
 * term or identity can reach the store. The server stamps the UTC time. The client never sends one.
 * `sessionId` is a random code held in tab memory only. It never links to an account.
 */
export const analyticsEventRequestSchema = z.strictObject({
  event: analyticsEventNameSchema,
  surface: analyticsSurfaceSchema,
  listingId: idSchema.optional(),
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
});
export type AnalyticsEventRequest = z.infer<typeof analyticsEventRequestSchema>;
