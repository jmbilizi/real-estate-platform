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
 * An open house's time range — "11am–1pm".
 *
 * Shared by the card's pill and the card's long form, because the two differ in what surrounds the
 * range, never in the range itself. It was duplicated once and the copies are exactly the kind that
 * drift: every rule below is a bug that was fixed in one place and would have to be re-fixed in the
 * other.
 */
function openHouseTimeRange(starts: Date, ends: Date): string {
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

  return `${sameMeridiem ? startText.slice(0, -2) : startText}–${endText}`;
}

/**
 * The *schedule* inside the card's open-house pill — `Sat 11am–1pm (9/5)`.
 *
 * The pill reads `Open: Sat 11am–1pm (9/5)`, but the `Open:` label is the card's own markup rather
 * than part of this string: it is bold and the schedule is not, so the two cannot be one text node.
 * This function owns everything derived from the listing; the card owns the word.
 *
 * The API populates `openHouse` **only** from an upcoming occurrence (`ends_at > now()`), so
 * "upcoming" is never re-derived here and an occurrence the API did not send is never displayed.
 *
 * Everything about this string is width. A card tile is ~189px and this pill shares its row with
 * the save control, which is why the affordance has been rebuilt so many times: three separate
 * pieces once (a badge, a star chip, a date row), then a corner pill that fit by dropping the date,
 * then a band across the image, then a pill with a second row beneath it.
 *
 * The **numeric date in parentheses** is what finally makes one pill work. `Sat, Sep 5` and `(9/5)`
 * say the same thing, and the second costs a third of the width — so the weekday and the time range
 * fit alongside it rather than being traded away for it. That matters because the date is the part
 * that must survive: "Open Sat" does not say *which* Saturday, and for an open house being off by a
 * week is a wasted trip to a house.
 *
 * Formatted in the property's time zone, not the viewer's, for the same reason as every other date
 * here: an open house happens where the house is.
 *
 * `formatOpenHouse` remains the long form for the detail page.
 */
export function formatOpenHouseBadge(openHouse: OpenHouse): string {
  const starts = new Date(openHouse.startsAt);
  const ends = new Date(openHouse.endsAt);

  const weekday = starts.toLocaleDateString('en-US', {
    weekday: 'short',
    timeZone: PROPERTY_TIME_ZONE,
  });

  // `numeric` rather than `2-digit`: "9/5", not "09/05" — the padding buys nothing at this size and
  // costs two characters in the one place characters are scarce.
  const date = starts.toLocaleDateString('en-US', {
    month: 'numeric',
    day: 'numeric',
    timeZone: PROPERTY_TIME_ZONE,
  });

  return `${weekday} ${openHouseTimeRange(starts, ends)} (${date})`;
}

/**
 * The *when* of an open house in full — "Sat, Sep 5 · 11am–1pm".
 *
 * Kept for surfaces with room to spell it out. The card no longer uses it: see
 * `formatOpenHouseBadge` for why a tile cannot afford this string.
 */
export function formatOpenHouseWhen(openHouse: OpenHouse): string {
  const starts = new Date(openHouse.startsAt);
  const ends = new Date(openHouse.endsAt);

  const day = starts.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: PROPERTY_TIME_ZONE,
  });

  return `${day} · ${openHouseTimeRange(starts, ends)}`;
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
