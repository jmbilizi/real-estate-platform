/** One body section of a legal page. */
export interface LegalSection {
  heading: string;
  body: readonly string[];
}

/** The content of one legal page. Copy lives in JSON modules, never inline in a page component. */
export interface LegalContent {
  title: string;
  /** ISO date (YYYY-MM-DD) the copy took effect. Null only when the date is unknown. */
  effectiveDate: string | null;
  sections: readonly LegalSection[];
  /** True blocks the prod deploy (`scripts/check-legal-content.js`). Published pages set false. */
  isDraft: boolean;
}

/**
 * Formats an ISO effective date for display, or a neutral note while there is none or the value
 * is not a real calendar date — a bad date must never render "Invalid Date", or a silently
 * rolled-over wrong date, on a public legal page.
 *
 * A pure UTC calendar date with its own fallback text, not `lib/format.ts`'s `formatDate`: that
 * helper renders a property timestamp in `PROPERTY_TIME_ZONE` and falls back to the raw string on
 * a parse error, both wrong for a legal effective date.
 */
export function formatEffectiveDate(effectiveDate: string | null): string {
  if (!effectiveDate) {
    return 'Date unavailable';
  }
  const date = new Date(`${effectiveDate}T00:00:00Z`);
  // `new Date` rolls an out-of-range day/month over (e.g. "2026-02-30" becomes March 2) instead
  // of failing, so `Number.isNaN` alone misses it. Re-deriving the ISO date and comparing it back
  // catches the rollover: a valid date always round-trips to the string that produced it.
  const isRealCalendarDate =
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === effectiveDate;
  if (!isRealCalendarDate) {
    return 'Date unavailable';
  }
  return date.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}
