import { z } from 'zod';
import { inquiryKindSchema, leadStatusSchema } from './listing-inquiry';

/**
 * Lead Desk metrics (#639). The response holds counts and durations only. No field names a
 * person, a listing or a lead id.
 */

/** Default age, in hours, after which a lead in `new` or `verified` counts as aging. */
export const STAFF_LEAD_AGING_HOURS_DEFAULT = 24;

/** Query of `GET /staff/leads/metrics`. Unknown parameters are rejected. */
export const staffLeadMetricsRequestSchema = z.strictObject({
  from: z.iso
    .datetime({ offset: true })
    .optional()
    .describe('Inclusive lower bound on the lead creation time. ISO 8601 with a zone.'),
  to: z.iso
    .datetime({ offset: true })
    .optional()
    .describe('Exclusive upper bound on the lead creation time. ISO 8601 with a zone.'),
});
export type StaffLeadMetricsRequest = z.infer<typeof staffLeadMetricsRequestSchema>;

/** A duration in whole seconds. Both values are null when no lead has made the step. */
export const staffLeadDurationSchema = z.object({
  sampleSize: z.number().int().nonnegative(),
  medianSeconds: z.number().int().nonnegative().nullable(),
  p90Seconds: z.number().int().nonnegative().nullable(),
});
export type StaffLeadDuration = z.infer<typeof staffLeadDurationSchema>;

export const staffLeadMetricsSchema = z.object({
  range: z.object({ from: z.string().nullable(), to: z.string().nullable() }),
  total: z.number().int().nonnegative(),
  /** Every status is present, with 0 when empty. */
  byStatus: z.record(leadStatusSchema, z.number().int().nonnegative()),
  byKind: z.record(inquiryKindSchema, z.number().int().nonnegative()),
  aging: z.object({
    thresholdHours: z.number().int().positive(),
    /** Leads in `new` or `verified` for longer than the threshold. */
    count: z.number().int().nonnegative(),
  }),
  /** Time from the creation of the lead to its first `verified` event. */
  timeToVerify: staffLeadDurationSchema,
  /** Time from `verified` to the first `assigned` event. */
  timeToAssign: staffLeadDurationSchema,
  /** Time from `assigned` to the first `accepted` event. */
  timeToAccept: staffLeadDurationSchema,
});
export type StaffLeadMetrics = z.infer<typeof staffLeadMetricsSchema>;
