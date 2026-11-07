/**
 * Listing timestamps render in the property's local time, never the viewer's (#79).
 *
 * The zone comes from the listing's state code. The table has one zone per state. A state that
 * spans two zones takes the zone of its most populous area. A listing in the other area carries
 * its own IANA zone on the wire contract (#983). `listingTimeZone` reads that first.
 */
export const STATE_TIME_ZONES: Readonly<Record<string, string>> = Object.freeze({
  AL: 'America/Chicago',
  AK: 'America/Anchorage',
  AZ: 'America/Phoenix',
  AR: 'America/Chicago',
  CA: 'America/Los_Angeles',
  CO: 'America/Denver',
  CT: 'America/New_York',
  DE: 'America/New_York',
  DC: 'America/New_York',
  FL: 'America/New_York',
  GA: 'America/New_York',
  HI: 'Pacific/Honolulu',
  ID: 'America/Boise',
  IL: 'America/Chicago',
  IN: 'America/Indiana/Indianapolis',
  IA: 'America/Chicago',
  KS: 'America/Chicago',
  KY: 'America/Kentucky/Louisville',
  LA: 'America/Chicago',
  ME: 'America/New_York',
  MD: 'America/New_York',
  MA: 'America/New_York',
  MI: 'America/Detroit',
  MN: 'America/Chicago',
  MS: 'America/Chicago',
  MO: 'America/Chicago',
  MT: 'America/Denver',
  NE: 'America/Chicago',
  NV: 'America/Los_Angeles',
  NH: 'America/New_York',
  NJ: 'America/New_York',
  NM: 'America/Denver',
  NY: 'America/New_York',
  NC: 'America/New_York',
  ND: 'America/Chicago',
  OH: 'America/New_York',
  OK: 'America/Chicago',
  OR: 'America/Los_Angeles',
  PA: 'America/New_York',
  RI: 'America/New_York',
  SC: 'America/New_York',
  SD: 'America/Chicago',
  TN: 'America/Chicago',
  TX: 'America/Chicago',
  UT: 'America/Denver',
  VT: 'America/New_York',
  VA: 'America/New_York',
  WA: 'America/Los_Angeles',
  WV: 'America/New_York',
  WI: 'America/Chicago',
  WY: 'America/Denver',
  PR: 'America/Puerto_Rico',
  VI: 'America/St_Thomas',
  GU: 'Pacific/Guam',
  AS: 'Pacific/Pago_Pago',
  MP: 'Pacific/Saipan',
});

/**
 * The zone for a row that carries no known state, and for a timestamp that belongs to no single
 * property (the footer's dataset-wide sync time). It is a fallback, not a market.
 */
export const PROPERTY_TIME_ZONE = 'America/New_York';

/** The display zone for a listing in `state`. An absent or unknown state gets the fallback. */
export function timeZoneForState(state: string | null | undefined): string {
  const key = state?.trim().toUpperCase();
  return (key && STATE_TIME_ZONES[key]) || PROPERTY_TIME_ZONE;
}

const knownZones = new Map<string, boolean>();

function isKnownTimeZone(zone: string): boolean {
  const cached = knownZones.get(zone);
  if (cached !== undefined) return cached;
  let known = true;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
  } catch {
    known = false;
  }
  knownZones.set(zone, known);
  return known;
}

/**
 * The display zone of a listing (#983). Order: the zone on the wire contract, the state table
 * (#79), then the fallback. A zone the runtime does not know is ignored, so a bad value cannot
 * throw inside a formatter.
 */
export function listingTimeZone(listing: {
  timeZone?: string | null;
  state?: string | null;
}): string {
  const zone = listing.timeZone?.trim();
  return zone && isKnownTimeZone(zone) ? zone : timeZoneForState(listing.state);
}
