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

/**
 * #459. "N min" under an hour, "N hr" under 24 hours, from the server-proven list instant.
 * `null` when there is no instant, it is unparseable, or it is 24 hours old or more, so the caller
 * falls back to the day buckets. Never derived from a date-only value.
 */
function formatPreciseTimeOnMarket(listedAtPrecise: string | null, now: number): string | null {
  if (listedAtPrecise === null) {
    return null;
  }
  const preciseMs = new Date(listedAtPrecise).getTime();
  if (Number.isNaN(preciseMs)) {
    return null;
  }
  const minutes = Math.max(1, Math.floor((now - preciseMs) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} hr` : null;
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
  const precise = formatPreciseTimeOnMarket(listedAtPrecise, now);
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
  const days = Math.floor((now - listedAtMs) / 86_400_000);
  if (days <= 0) return 'today';
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  const months = Math.floor(days / 30);
  if (months <= 11) return `${months}mo`;
  return `${Math.max(1, Math.floor(days / 365))}y`;
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
