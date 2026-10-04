import type { ListingSource, ListingType, OpenHouse } from '@cribstop/property-contracts';
import { BRAND } from '@/lib/brand';
import { formatNumber, formatPrice, formatPriceShort, PROPERTY_TIME_ZONE } from '@/lib/format';

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

/**
 * The provenance sentence for one row, driven off **that row's** `source` and nothing else.
 *
 * It lives here because three surfaces publish it — the detail page, the share text and the link
 * preview — and a provenance claim that differs between them is a misstatement on whichever one is
 * wrong. `other` returns null: neither Bright's claim nor ours is true for that row.
 *
 * The reasoning behind each sentence is in `components/listing/ListingProvenance`.
 */
export function formatListingProvenance(source: ListingSource): string | null {
  if (source === 'brightMLS') {
    return 'Information provided by Bright MLS. Deemed reliable but not guaranteed.';
  }
  if (source === 'internal') {
    return `Listing information provided by ${BRAND.siteDomain}. Deemed reliable but not guaranteed.`;
  }
  return null;
}

export interface PriceDisplay {
  text: string;
  /** Lets a render site style the withheld sentence as prose rather than as a number. */
  isWithheld: boolean;
}

export function formatListingPrice(price: number | null, listingType: ListingType): PriceDisplay {
  if (price === null) return { text: PRICE_WITHHELD_COPY, isWithheld: true };
  return { text: formatPrice(price, listingType), isWithheld: false };
}

/** Compact withheld label for a map pill. The card and the popup carry the full sentence. */
export const PRICE_WITHHELD_SHORT = 'Withheld';

/**
 * The map pill text. It follows `formatListingPrice` rule for rule: a null price is withheld, never
 * `$0`, and a rent price keeps `/mo`. Only the figure is shortened.
 */
export function formatListingPriceShort(
  price: number | null,
  listingType: ListingType,
): PriceDisplay {
  if (price === null) return { text: PRICE_WITHHELD_SHORT, isWithheld: true };
  return { text: formatPriceShort(price, listingType), isWithheld: false };
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

/** `"FREDERICK"` → `"Frederick"`. Feeds write place names upper case; display never does. */
function titleCasePlace(value: string): string {
  if (value !== value.toUpperCase()) return value;
  return value
    .toLowerCase()
    .replace(
      /(^|[\s\-'/])([a-z])/g,
      (_, lead: string, letter: string) => lead + letter.toUpperCase(),
    );
}

/**
 * The card's address line: `"420 Herringbone Way, Frederick, MD 21701"`.
 *
 * A seller-suppressed address (`address` null) shows `"Frederick, MD"` only — the city and state the
 * row already publishes — never a street, and never the ZIP, which narrows the withheld address.
 */
export function formatCardAddress(listing: {
  address: string | null;
  city: string;
  state: string;
  zip: string;
}): string {
  const city = titleCasePlace(listing.city);
  if (!listing.address) return `${city}, ${listing.state}`;
  return `${listing.address}, ${city}, ${listing.state} ${listing.zip}`;
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
/**
 * The open-house date alone — `11/22`.
 *
 * The last thing standing on a card too narrow for anything else, which on the search grid at a
 * 768px viewport means a 139px card with 83px of room. The date is what survives every squeeze,
 * because it is the part that costs a wasted trip to a house if it is wrong.
 *
 * `numeric` rather than `2-digit` throughout: "9/5", not "09/05" — the padding buys nothing at this
 * size and costs two characters in the one place characters are scarce.
 */
export function formatOpenHouseDate(openHouse: OpenHouse): string {
  return new Date(openHouse.startsAt).toLocaleDateString('en-US', {
    month: 'numeric',
    day: 'numeric',
    timeZone: PROPERTY_TIME_ZONE,
  });
}

/**
 * Time and date, without the weekday — `7–9am (8/16)`.
 *
 * The middle of the badge's three forms. The weekday is the first thing dropped because it is the
 * only part that carries no information the rest does not: `8/16` already determines it. The time
 * only goes at the narrowest widths, where even this does not fit.
 */
export function formatOpenHouseTimeAndDate(openHouse: OpenHouse): string {
  const starts = new Date(openHouse.startsAt);
  const ends = new Date(openHouse.endsAt);

  return `${openHouseTimeRange(starts, ends)} (${formatOpenHouseDate(openHouse)})`;
}

export function formatOpenHouseBadge(openHouse: OpenHouse): string {
  const starts = new Date(openHouse.startsAt);

  const weekday = starts.toLocaleDateString('en-US', {
    weekday: 'short',
    timeZone: PROPERTY_TIME_ZONE,
  });

  return `${weekday} ${formatOpenHouseTimeAndDate(openHouse)}`;
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

/**
 * #424. The active date for the Coming Soon badge, `MMM d` (`Oct 15`) — never a numeric date, the
 * stakeholder rejected `10/15` for this badge specifically. `null` means the badge shows no date:
 * the feed carried none, or a stale sync left a date already in the past (the listing going active
 * is not something the badge should state as still upcoming).
 *
 * Formatted in UTC, unlike the open-house dates above: the contract widens Bright's date-only
 * `ExpectedOnMarketDate` to midnight UTC (there is no real time of day to place in a time zone), so
 * formatting it in `PROPERTY_TIME_ZONE` would read back a day early for every US zone — "today" is
 * read in UTC for the same reason. `now` is injectable for tests; defaults to the real clock.
 */
function comingSoonActiveDate(comingSoonDate: string | null, now: Date): string | null {
  if (comingSoonDate === null) {
    return null;
  }
  const todayUtcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const date = new Date(comingSoonDate);
  if (date.getTime() < todayUtcMidnight) {
    return null;
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/**
 * The full badge text — "Coming soon Oct 15", or "Coming soon" alone when there is no date to
 * show. Used from `sm` up, where every card ("ListingCard" renders on the search grid, the home
 * carousels, favourites, and nearby homes) has room for it.
 */
export function formatComingSoonBadge(
  comingSoonDate: string | null,
  now: Date = new Date(),
): string {
  const date = comingSoonActiveDate(comingSoonDate, now);
  return date === null ? 'Coming soon' : `Coming soon ${date}`;
}

/**
 * The compact form — "Soon · Oct 15" — for below `sm`. `ListingRow`'s home carousel renders at
 * `~42%` of the viewport (`CARD_WIDTH_CLASS`), which is only ~127px of usable width inside the
 * photo's gutters at a 360px viewport; "Coming soon Oct 15" measures wider than that at 11px, and
 * this badge never truncates or wraps. Same no-date fallback as the full form.
 */
export function formatComingSoonBadgeShort(
  comingSoonDate: string | null,
  now: Date = new Date(),
): string {
  const date = comingSoonActiveDate(comingSoonDate, now);
  return date === null ? 'Coming soon' : `Soon · ${date}`;
}

/**
 * #433. The office avatar's letter: the first letter or digit of `officeName`, upper-cased.
 * "Real Broker, LLC" -> "R", "& Company Realty" -> "C". Never empty: `officeName` is a required,
 * non-blank field on every row this renders for.
 */
export function officeInitial(officeName: string): string {
  const match = officeName.match(/[\p{L}\p{N}]/u);
  return (match ? match[0] : officeName.trim().charAt(0)).toUpperCase();
}

/** Literal class names, so Tailwind finds them in the source. */
const AVATAR_TONES = [
  'bg-avatar-1',
  'bg-avatar-2',
  'bg-avatar-3',
  'bg-avatar-4',
  'bg-avatar-5',
  'bg-avatar-6',
  'bg-avatar-7',
  'bg-avatar-8',
] as const;

/**
 * The office avatar's background, fixed per letter like Google's account avatars: every office
 * that starts with "R" gets the same tone. A-Z cycle through the eight tones. Anything else (a
 * digit, a non-Latin letter) gets the neutral last tone.
 */
export function officeAvatarTone(initial: string): string {
  const index = initial.toUpperCase().charCodeAt(0) - 65;
  return index >= 0 && index < 26 ? AVATAR_TONES[index % AVATAR_TONES.length] : AVATAR_TONES[7];
}

/** #571. The agent monogram: first letters of the first and last name word. "Jane Q. Agent" -> "JA". */
export function agentInitials(name: string): string {
  const all = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  const words = all.filter((w, i) => i === 0 || !/^(jr|sr|ii|iii|iv|esq|team|group)$/i.test(w));
  if (words.length === 0) return '';
  const first = words[0].charAt(0);
  const last = words.length > 1 ? words[words.length - 1].charAt(0) : '';
  return (first + last).toUpperCase();
}

/** `tel:` target for a display phone. Keeps digits and a leading "+". Null when no digit remains. */
export function telHref(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 0) return null;
  return `tel:${phone.trim().startsWith('+') ? '+' : ''}${digits}`;
}

export interface AgentContactLine {
  kind: 'phone' | 'email';
  owner: 'Agent' | 'Office' | 'Agent / Office';
  value: string;
  href: string;
}

/**
 * #571. Every contact line the agent card shows: agent phone, agent email, then the office lines.
 * Blank values are omitted. A value equal to an earlier line is dropped, so one number never
 * shows twice. The office lines stay because NAR 7.58 needs the firm plus a participant-supplied
 * contact method on the display.
 */
export function agentContactLines(l: {
  listAgentPhone: string | null;
  listAgentEmail: string | null;
  brokerPhone: string;
  brokerEmail: string | null;
  officeBrokerLeadPhone: string | null;
  officeBrokerLeadEmail: string | null;
}): AgentContactLine[] {
  const candidates: Array<[AgentContactLine['kind'], AgentContactLine['owner'], string | null]> = [
    ['phone', 'Agent', l.listAgentPhone],
    ['email', 'Agent', l.listAgentEmail],
    ['phone', 'Office', l.brokerPhone],
    ['email', 'Office', l.brokerEmail],
    ['phone', 'Office', l.officeBrokerLeadPhone],
    ['email', 'Office', l.officeBrokerLeadEmail],
  ];
  const seen = new Map<string, AgentContactLine>();
  const lines: AgentContactLine[] = [];
  for (const [kind, owner, raw] of candidates) {
    const value = raw?.trim();
    if (!value) continue;
    const href = kind === 'phone' ? telHref(value) : `mailto:${value}`;
    if (!href) continue;
    const key = `${kind}:${kind === 'phone' ? value.replace(/\D/g, '') : value.toLowerCase()}`;
    const earlier = seen.get(key);
    if (earlier) {
      // The agent and the office share this value. Keep one line and name both owners.
      if (earlier.owner !== owner) earlier.owner = 'Agent / Office';
      continue;
    }
    const line: AgentContactLine = { kind, owner, value, href };
    seen.set(key, line);
    lines.push(line);
  }
  return lines;
}
