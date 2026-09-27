/**
 * One place to widen a feed `YYYY-MM-DD` date-only string to midnight UTC.
 *
 * Three call sites did this inline before #391: `bright-map/map-record.ts` (twice — the sold
 * display-delay window's `CloseDate` comparison, and #391's `listed_at`) and `mls-attributes.ts`'s
 * calendar-validity check. All three need the same instant, so one function keeps them from
 * quietly drifting apart.
 *
 * Returns `null` for a value the round trip does not confirm — `2026-02-30` and `2026-13-01` both
 * match `YYYY-MM-DD` shape but are not real calendar dates; JS rolls the impossible day into the
 * next month instead of raising, so the round trip is what catches it, not the parse itself.
 */
export function parseCalendarDate(value: string): Date | null {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
    ? null
    : parsed;
}
