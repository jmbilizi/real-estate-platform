import type { ListingType, OpenHouse } from '@cribstop/property-contracts';
import { formatNumber, formatPrice, PROPERTY_TIME_ZONE } from '@/lib/format';

/**
 * Null-safe presentation of listing fields.
 *
 * Every field the wire contract makes nullable is formatted here rather than at the render site,
 * so each compliance rule has exactly one implementation. The contract's rule is
 * nullable-always-present: a field that can legitimately be absent is `T | null` with the key
 * always there, never a `0` or `""` standing in for "unknown". Formatting a sentinel as though it
 * were a fact is how a fabricated number reaches a consumer.
 */

/**
 * Bright is rolling out seller-directed field-level suppression in the DMV. A withheld price is
 * never blank, never `$0`, and never an estimate — an imputed price is both a fabricated fact
 * (PRD §6.3) and a display-rule violation.
 */
export const PRICE_WITHHELD_COPY = 'Price withheld at the seller’s direction';

export interface PriceDisplay {
  text: string;
  /** Lets a render site style the withheld sentence as prose rather than as a number. */
  isWithheld: boolean;
}

export function formatListingPrice(price: number | null, listingType: ListingType): PriceDisplay {
  if (price === null) return { text: PRICE_WITHHELD_COPY, isWithheld: true };
  return { text: formatPrice(price, listingType), isWithheld: false };
}

/**
 * A sold row shows what it actually closed at, not the ask. `price` remains available as the ask
 * where showing both is useful.
 */
export function formatClosePrice(
  closePrice: number | null,
  closeDate: string | null,
): string | null {
  if (closePrice === null) return null;
  const amount = formatPrice(closePrice, 'sold');
  if (closeDate === null) return `Sold for ${amount}`;
  return `Sold for ${amount} on ${formatCloseDate(closeDate)}`;
}

/** `closeDate` is a plain `YYYY-MM-DD`; parsing it as a UTC instant would shift the day locally. */
export function formatCloseDate(closeDate: string): string {
  const [year, month, day] = closeDate.split('-').map(Number);
  if (!year || !month || !day) return closeDate;
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * The dwelling triplet, with each part omitted when the API sends null rather than rendered as a
 * dash or a zero. Returns null when nothing is known, so a caller renders no line at all.
 */
export function formatDwellingStats(
  beds: number | null,
  baths: number | null,
  sqft: number | null,
): string | null {
  const parts: string[] = [];
  if (beds !== null) parts.push(`${beds} bd`);
  if (baths !== null) parts.push(`${baths} ba`);
  if (sqft !== null) parts.push(`${formatNumber(sqft)} sqft`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** An acre is 43,560 sqft. Below a quarter acre, sqft is what a consumer scanning parcels reads. */
const SQFT_PER_ACRE = 43_560;
const ACRE_THRESHOLD_SQFT = SQFT_PER_ACRE / 4;

/**
 * Lot size with the unit selected by magnitude — "2.4 acres lot" / "10,454 sqft lot" — which is
 * what a parcel card shows in place of the bed/bath/sqft triplet.
 */
export function formatLotSize(lotSqft: number | null): string | null {
  if (lotSqft === null || lotSqft <= 0) return null;

  if (lotSqft >= ACRE_THRESHOLD_SQFT) {
    const acres = lotSqft / SQFT_PER_ACRE;
    const rounded = acres >= 10 ? Math.round(acres) : Math.round(acres * 10) / 10;
    return `${formatNumber(rounded)} ${rounded === 1 ? 'acre' : 'acres'} lot`;
  }

  return `${formatNumber(lotSqft)} sqft lot`;
}

/**
 * The card title. `neighborhood` null falls back to `city, state` — never a bare comma, which is
 * what `{neighborhood}, {city}` produced when the neighbourhood was unknown.
 */
export function formatListingLocation(
  neighborhood: string | null,
  city: string,
  state: string,
): string {
  if (neighborhood) return `${neighborhood}, ${city}`;
  return `${city}, ${state}`;
}

/**
 * The full address line, or null when the seller opted out of address display.
 *
 * `address`, `latitude` and `longitude` are null together for such a row. There is deliberately no
 * city or ZIP fallback here: a centroid is fabricated precision and partially re-identifies the
 * address the seller withheld.
 */
export function formatStreetAddress(
  address: string | null,
  city: string,
  state: string,
  zip: string,
): string | null {
  if (!address) return null;
  return `${address}, ${city}, ${state} ${zip}`;
}

/** True only when a row has both coordinates, which is the only case that may produce a map pin. */
export function hasMapCoordinates(listing: {
  latitude: number | null;
  longitude: number | null;
}): listing is { latitude: number; longitude: number } {
  return listing.latitude !== null && listing.longitude !== null;
}

/**
 * Renders the API's open-house occurrence. The API populates `openHouse` **only** from an upcoming
 * occurrence (`ends_at > now()`), so "upcoming" is never re-derived here and an occurrence the API
 * did not send is never displayed.
 */
/**
 * The compact form for a card badge — "Open Sat 1–3 PM".
 *
 * A card used to carry three separate open-house affordances (a badge, a star chip beside the title,
 * and a full date/time line). The line was also the only text row that existed on open-house cards
 * and nowhere else, so it made tiles in a grid different heights. One badge on the image carries
 * both the fact and the when; `formatOpenHouse` remains the long form for the detail page.
 */
export function formatOpenHouseBadge(openHouse: OpenHouse): string {
  const starts = new Date(openHouse.startsAt);
  const ends = new Date(openHouse.endsAt);

  const day = starts.toLocaleDateString('en-US', {
    weekday: 'short',
    timeZone: PROPERTY_TIME_ZONE,
  });
  // Lowercase, unspaced meridiem ("9am") is both the listing-sheet convention and materially
  // narrower — the badge sits on the image next to the save control and has little room.
  //
  // The separator before the meridiem is stripped with `\s`, not a literal space: ICU 72 (Node
  // 18.13+) switched `en-US` to U+202F NARROW NO-BREAK SPACE there, so matching a plain space
  // silently stops working on a runtime upgrade and leaves "5 pm" in a badge sized for "5pm".
  const hour = (d: Date) =>
    d
      .toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: PROPERTY_TIME_ZONE,
      })
      .replace(':00', '')
      .replace(/\s/g, '')
      .toLowerCase();

  // The meridiem is dropped from the start when both ends share it, the way a listing sheet reads.
  const startText = hour(starts);
  const endText = hour(ends);
  const sameMeridiem = startText.slice(-2) === endText.slice(-2);

  return `Open ${day} ${sameMeridiem ? startText.slice(0, -2) : startText}–${endText}`;
}

export function formatOpenHouse(openHouse: OpenHouse): string {
  const starts = new Date(openHouse.startsAt);
  const ends = new Date(openHouse.endsAt);

  const day = starts.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: PROPERTY_TIME_ZONE,
  });
  const time = (d: Date) =>
    d
      .toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: PROPERTY_TIME_ZONE,
      })
      .replace(':00', '');

  return `${day}, ${time(starts)}–${time(ends)}`;
}
