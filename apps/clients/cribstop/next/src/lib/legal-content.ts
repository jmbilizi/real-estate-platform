/** One body section of a legal page. */
export interface LegalSection {
  heading: string;
  body: readonly string[];
}

/**
 * The content of one legal page. Copy lives here, never inline in a page component, so approved
 * copy from #156 is a content change, not a component change.
 */
export interface LegalContent {
  title: string;
  /** ISO date (YYYY-MM-DD) the copy took effect. Null only while `isDraft` is true. */
  effectiveDate: string | null;
  sections: readonly LegalSection[];
  /**
   * True until #156 delivers approved copy. `LegalPage` shows a draft banner while this is set;
   * see #157 for the pending decision on a build- or deploy-time block.
   */
  isDraft: boolean;
}

/**
 * Formats an ISO effective date for display, or a pending note while there is none or the value
 * is not a real calendar date — a bad date must never render "Invalid Date", or a silently
 * rolled-over wrong date, on a public legal page.
 *
 * A pure UTC calendar date with its own fallback text, not `lib/format.ts`'s `formatDate`: that
 * helper renders a property timestamp in `PROPERTY_TIME_ZONE` and falls back to the raw string on
 * a parse error, both wrong for a legal effective date.
 */
export function formatEffectiveDate(effectiveDate: string | null): string {
  if (!effectiveDate) {
    return 'Pending legal approval';
  }
  const date = new Date(`${effectiveDate}T00:00:00Z`);
  // `new Date` rolls an out-of-range day/month over (e.g. "2026-02-30" becomes March 2) instead
  // of failing, so `Number.isNaN` alone misses it. Re-deriving the ISO date and comparing it back
  // catches the rollover: a valid date always round-trips to the string that produced it.
  const isRealCalendarDate =
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === effectiveDate;
  if (!isRealCalendarDate) {
    return 'Pending legal approval';
  }
  return date.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}
