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
 * does not parse — a malformed date must never render "Invalid Date" on a public legal page.
 */
export function formatEffectiveDate(effectiveDate: string | null): string {
  if (!effectiveDate) {
    return 'Pending legal approval';
  }
  const date = new Date(`${effectiveDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return 'Pending legal approval';
  }
  return date.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}
