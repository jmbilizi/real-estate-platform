/**
 * Listing timestamps render in the **property's** local time, never the viewer's.
 *
 * `toLocaleString` with no `timeZone` uses whatever zone the runtime happens to be in. That made
 * the same open house read "9am–1pm" on an Eastern machine and "1–5pm" in UTC CI — and, shipped,
 * it would have shown a buyer in California a DC open house at the wrong hour, or near midnight on
 * the wrong day. An open house is an appointment at the property; the property's clock is the only
 * correct one.
 *
 * Real Broker, LLC is licensed in MD/DC/VA (PRD §6.1) and all three are Eastern, so a single
 * constant is unambiguous today. The moment the brokerage licenses outside Eastern this has to
 * become a per-property zone carried on the listing — it cannot stay a constant. Tracked as #79,
 * which is a blocker on licensing outside Eastern rather than routine cleanup.
 */
export const PROPERTY_TIME_ZONE = 'America/New_York';

export function formatPrice(value: number, listingType?: 'sale' | 'rent' | 'sold'): string {
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
  return listingType === 'rent' ? `${formatted}/mo` : formatted;
}

/** `2.0` becomes `2`. Keeps `2.1`. */
function trimDecimals(value: number, digits: number): string {
  return String(Number(value.toFixed(digits)));
}

/**
 * Compact price for a map pill: `$585K`, `$2.1M`, `$2.1K/mo`. It shortens the figure
 * `formatPrice` prints and changes nothing else, so a pill and a card never name different prices.
 * It never rounds a price up to the next unit: `$999,600` reads `$1M`, not `$1000K`.
 */
export function formatPriceShort(value: number, listingType?: 'sale' | 'rent' | 'sold'): string {
  const suffix = listingType === 'rent' ? '/mo' : '';
  if (value >= 999_500) return `$${trimDecimals(value / 1_000_000, 2)}M${suffix}`;
  if (value >= 10_000) return `$${Math.round(value / 1000)}K${suffix}`;
  if (value >= 1000) return `$${trimDecimals(value / 1000, 1)}K${suffix}`;
  return `$${Math.round(value)}${suffix}`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: PROPERTY_TIME_ZONE,
    });
  } catch {
    return iso;
  }
}

/**
 * "3 hours ago" style freshness copy for the home page trust block.
 *
 * Bucketed by hand rather than `Intl.RelativeTimeFormat`: that API rounds toward the nearest unit
 * and reads oddly at the edges ("in 0 hours"). Buckets floor toward the past, which always reads
 * as a plain elapsed-time statement — the only shape this compliance-facing copy needs.
 */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const diffMs = Math.max(0, now - new Date(iso).getTime());
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

/** Elapsed time on market, in the unit the shared rules pick. `day` with `value` 0 means "today". */
export interface ListingAge {
  unit: 'min' | 'hr' | 'day';
  value: number;
}

/**
 * #459. Minutes under an hour, hours under 24 hours, from the server-proven list instant.
 * `null` when there is no instant, it is unparseable, or it is 24 hours old or more, so the caller
 * falls back to the day buckets. Never derived from a date-only value.
 */
function preciseListingAge(listedAtPrecise: string | null, now: number): ListingAge | null {
  if (listedAtPrecise === null) {
    return null;
  }
  const preciseMs = new Date(listedAtPrecise).getTime();
  if (Number.isNaN(preciseMs)) {
    return null;
  }
  const minutes = Math.max(1, Math.floor((now - preciseMs) / 60_000));
  if (minutes < 60) return { unit: 'min', value: minutes };
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? { unit: 'hr', value: hours } : null;
}

/**
 * #542. Whole calendar days from the MLS list date to today in the property's time zone.
 * `listedAt` is a date-only MLS value widened to midnight UTC, so its UTC date is the original
 * list date. Counting 24-hour periods read "1 day ago" from 8pm Eastern on the list date.
 * Calendar math also keeps a DST change day from shifting the count.
 */
function calendarDaysSince(listed: Date, now: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PROPERTY_TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date(now));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const today = Date.UTC(part('year'), part('month') - 1, part('day'));
  const listedDay = Date.UTC(listed.getUTCFullYear(), listed.getUTCMonth(), listed.getUTCDate());
  return Math.max(0, Math.round((today - listedDay) / 86_400_000));
}

/**
 * #542. The one rule set behind both time-on-market strings (footer and new-listing badge).
 * Precise instant first, then whole elapsed days from `listedAt`. `null` when neither is usable.
 */
export function listingAge(
  listedAt: string | null,
  now: number = Date.now(),
  listedAtPrecise: string | null = null,
): ListingAge | null {
  const precise = preciseListingAge(listedAtPrecise, now);
  if (precise !== null) {
    return precise;
  }
  if (listedAt === null) {
    return null;
  }
  const listedAtMs = new Date(listedAt).getTime();
  // An unparseable string reads the same as unknown: no dot, no text, not a garbage bucket.
  if (Number.isNaN(listedAtMs)) {
    return null;
  }
  return { unit: 'day', value: calendarDaysSince(new Date(listedAtMs), now) };
}

/** #542. A listing under this many days old gets the new-listing badge, not the footer time. */
export const NEW_LISTING_MAX_DAYS = 7;

/** True when the age is under {@link NEW_LISTING_MAX_DAYS} days. Minutes and hours always are. */
export function isNewListingAge(age: ListingAge | null): boolean {
  return age !== null && (age.unit !== 'day' || age.value < NEW_LISTING_MAX_DAYS);
}

/**
 * #433. Time on market, short bucketed form: "today", "1d"–"6d", "1w"–"4w", "1mo"–"11mo", "1y"+.
 * `null` when `listedAt` is unknown — the caller renders no separating dot and no text, not a
 * placeholder.
 *
 * Days-based buckets, not calendar-accurate months: this is a glanced-at freshness cue on a photo
 * card, not an audited figure, and a flat 30-day month keeps every bucket a simple, monotonic
 * function of elapsed days. `now` is injectable for tests; defaults to the real clock.
 */
export function formatTimeOnMarket(
  listedAt: string | null,
  now: number = Date.now(),
  listedAtPrecise: string | null = null,
): string | null {
  const age = listingAge(listedAt, now, listedAtPrecise);
  if (age === null) return null;
  if (age.unit !== 'day') return `${age.value} ${age.unit}`;
  const days = age.value;
  if (days <= 0) return 'today';
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  const months = Math.floor(days / 30);
  if (months <= 11) return `${months}mo`;
  return `${Math.max(1, Math.floor(days / 365))}y`;
}

/**
 * #565. The age words shared by the card badge and the gallery badge: "12 min ago", "Today",
 * "1 day ago". `null` at 7 days or older, and when the age is unknown. Shares {@link listingAge}
 * with the footer, so it never invents a time from a date-only value. The wording lives only here.
 */
export function formatNewListingAge(
  listedAt: string | null,
  now: number = Date.now(),
  listedAtPrecise: string | null = null,
): string | null {
  const age = listingAge(listedAt, now, listedAtPrecise);
  if (age === null || !isNewListingAge(age)) return null;
  if (age.unit === 'min') return `${age.value} min ago`;
  if (age.unit === 'hr') return `${age.value} hr ago`;
  if (age.value === 0) return 'Today';
  return `${age.value} ${age.value === 1 ? 'day' : 'days'} ago`;
}

/** #542. The new-listing badge text, e.g. "New · 12 min ago". `null` when there is no age to show. */
export function formatNewListingBadge(
  listedAt: string | null,
  now: number = Date.now(),
  listedAtPrecise: string | null = null,
): string | null {
  const age = formatNewListingAge(listedAt, now, listedAtPrecise);
  return age === null ? null : `New · ${age}`;
}

export function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: PROPERTY_TIME_ZONE,
    });
  } catch {
    return iso;
  }
}
