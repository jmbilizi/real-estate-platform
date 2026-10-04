/**
 * Centralized brand configuration.
 *
 * Bright MLS requires the licensed brokerage ("Real Broker, LLC") to be the
 * primary, most-prominent brand on the site.  "Cribstop" may still appear but
 * must always be smaller and less prominent than the brokerage name.
 *
 * Update values here and they propagate everywhere — navbar, footer, metadata,
 * page copy, etc.
 */

/** The two-letter codes behind `BRAND.licensedStates` — the single source both derive from, so a
 *  prose sentence and a state-count tile can never disagree about how many states that is. */
const LICENSED_STATE_CODES = ['MD', 'DC', 'VA'] as const;

/** "MD, DC, and VA" — an Oxford-comma join, generic over the list length. */
function joinWithAnd(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

export const BRAND = {
  /** Licensed brokerage — must be the most prominent brand on the site. */
  brokerage: 'Real Broker, LLC',

  /** Short brokerage reference (without ", LLC") for running text. */
  brokerageShort: 'Real Broker LLC',

  /** Site / product name — always displayed smaller than the brokerage. */
  siteName: 'Cribstop',

  /** Pillar names. Page copy reads these; never hardcode a pillar name (#89). */
  pillars: {
    connect: 'Connect',
  },

  /** Full site domain shown in copy. */
  siteDomain: 'Cribstop.com',

  /**
   * The only contact address the site publishes. It matches the reply-to on
   * outbound account mail, so a consumer who replies and a consumer who copies
   * the address from a page reach the same inbox.
   *
   * There is no second address and no published phone number. A `support@`
   * mailbox and an `(800) 555-CRIB` number were mock values that reached
   * production copy; both are removed (#284). Add a contact method here only
   * when it is real and monitored.
   */
  contactEmail: 'contact@cribstop.com',

  /** Two-letter codes for every state where the brokerage is licensed. */
  licensedStateCodes: LICENSED_STATE_CODES,

  /** States where the brokerage is licensed, as running prose. Derived from `licensedStateCodes`. */
  licensedStates: joinWithAnd(LICENSED_STATE_CODES),

  /** Page-title suffix used in <head>. */
  titleSuffix: 'Find Your Next Home',

  /** Default meta description. */
  metaDescription: 'Browse homes for sale and rent in the DMV area. Brokered by Real Broker, LLC.',

  /** Fair Housing Act statement text (PRD §6.1). Wording is fixed by HUD, not brand style. */
  equalHousingOpportunity: 'Equal Housing Opportunity',
} as const;
