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

export const BRAND = {
  /** Licensed brokerage — must be the most prominent brand on the site. */
  brokerage: 'Real Broker, LLC',

  /** Short brokerage reference (without ", LLC") for running text. */
  brokerageShort: 'Real Broker LLC',

  /** Site / product name — always displayed smaller than the brokerage. */
  siteName: 'Cribstop',

  /** Full site domain shown in copy. */
  siteDomain: 'Cribstop.com',

  /** Support email address. */
  supportEmail: 'support@cribstop.com',

  /**
   * General contact address shown to a consumer who must reply to us.
   * It matches the reply-to on outbound account mail, so a consumer who replies
   * and a consumer who copies the address from a page reach the same inbox.
   */
  contactEmail: 'contact@cribstop.com',

  /** Support phone number. */
  supportPhone: '(800) 555-CRIB',

  /** States where the brokerage is licensed. */
  licensedStates: 'MD, DC, and VA',

  /** Page-title suffix used in <head>. */
  titleSuffix: 'Find Your Next Home',

  /** Default meta description. */
  metaDescription: 'Browse homes for sale and rent in the DMV area. Brokered by Real Broker, LLC.',

  /** Fair Housing Act statement text (PRD §6.1). Wording is fixed by HUD, not brand style. */
  equalHousingOpportunity: 'Equal Housing Opportunity',
} as const;
