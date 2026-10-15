import { z } from 'zod';
import { idSchema, propertyTypeSchema } from './common';

/**
 * "What I'm looking for" (#768). An account keeps up to `LOOKING_FOR_MAX_PER_ACCOUNT` saved search
 * preferences. A preference belongs to the account, never to a role (PRD §11.2). It holds facts
 * about the home only. It sends no email.
 */

export const LOOKING_FOR_MAX_PER_ACCOUNT = 5;
export const LOOKING_FOR_MAX_PLACES = 5;
export const LOOKING_FOR_MAX_PRICE = 100_000_000;
export const LOOKING_FOR_MAX_ROOMS = 20;

const state = z.string().regex(/^[A-Z]{2}$/);
const city = z.string().regex(/^[\p{L}\p{N}][\p{L}\p{N} .'&-]{0,99}$/u);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** City and zip only, until the web form can show and edit the other place kinds. */
export const lookingForPlaceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('city'), state, city }),
  z.strictObject({
    kind: z.literal('zip'),
    state,
    city,
    zip: z.string().regex(/^\d{5}$/),
  }),
]);

const price = z.number().int().min(0).max(LOOKING_FOR_MAX_PRICE);
const rooms = z.number().int().min(0).max(LOOKING_FOR_MAX_ROOMS);

export const lookingForRequestSchema = z
  .strictObject({
    intent: z.enum(['buy', 'rent']),
    places: z.array(lookingForPlaceSchema).min(1).max(LOOKING_FOR_MAX_PLACES),
    priceMin: price.nullish(),
    priceMax: price.nullish(),
    bedsMin: rooms.nullish(),
    bathsMin: rooms.nullish(),
    homeTypes: z
      .array(propertyTypeSchema)
      .refine((types) => new Set(types).size === types.length)
      .nullish(),
    /** yyyy-MM-dd. A move-in date, or the first day of a buying window. */
    whenStart: isoDate.nullish(),
    /** yyyy-MM-dd. The last day of a buying window. Needs `whenStart`. */
    whenEnd: isoDate.nullish(),
  })
  .superRefine((value, ctx) => {
    if (value.priceMin != null && value.priceMax != null && value.priceMin > value.priceMax) {
      ctx.addIssue({ code: 'custom', path: ['priceMax'], message: 'Below the minimum.' });
    }
    if (value.whenStart == null) {
      if (value.whenEnd != null) {
        ctx.addIssue({ code: 'custom', path: ['whenEnd'], message: 'Needs a start date.' });
      }
      return;
    }
    for (const field of ['whenStart', 'whenEnd'] as const) {
      const date = value[field];
      if (date != null && !isCalendarDate(date)) {
        ctx.addIssue({ code: 'custom', path: [field], message: 'Not a date.' });
      }
    }
    if (value.whenEnd != null && value.whenEnd < value.whenStart) {
      ctx.addIssue({ code: 'custom', path: ['whenEnd'], message: 'Before the start date.' });
    }
  });

/** `2026-02-30` matches the pattern but names no day. */
function isCalendarDate(date: string): boolean {
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

export const lookingForSchema = z.object({
  id: idSchema,
  intent: z.enum(['buy', 'rent']),
  places: z.array(lookingForPlaceSchema),
  priceMin: z.number().int().nullable(),
  priceMax: z.number().int().nullable(),
  bedsMin: z.number().int().nullable(),
  bathsMin: z.number().int().nullable(),
  homeTypes: z.array(propertyTypeSchema),
  whenStart: isoDate.nullable(),
  whenEnd: isoDate.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const lookingForListSchema = z.object({
  /** Newest change first. */
  items: z.array(lookingForSchema),
  max: z.literal(LOOKING_FOR_MAX_PER_ACCOUNT),
});

/** The 400 body. `fields` names each refused field. It never echoes a value. */
export const lookingForInvalidBodySchema = z.object({
  error: z.object({
    code: z.literal('invalid_request'),
    message: z.string(),
    fields: z.array(z.string()),
  }),
});

/** The 409 body of a new preference past the limit. */
export const LOOKING_FOR_LIMIT_BODY = Object.freeze({
  error: Object.freeze({
    code: 'conflict',
    message: `An account keeps at most ${LOOKING_FOR_MAX_PER_ACCOUNT} preferences.`,
  } as const),
} as const);

export type LookingForInvalidBody = z.infer<typeof lookingForInvalidBodySchema>;
export type LookingForPlace = z.infer<typeof lookingForPlaceSchema>;
export type LookingForRequest = z.input<typeof lookingForRequestSchema>;
export type LookingFor = z.infer<typeof lookingForSchema>;
export type LookingForList = z.infer<typeof lookingForListSchema>;
