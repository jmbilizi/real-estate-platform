const MARKET_TIME_ZONE = 'America/New_York';

const zoneParts = new Intl.DateTimeFormat('en-US', {
  timeZone: MARKET_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function localParts(instant: Date): { date: string; midnight: boolean } {
  const p: Record<string, string> = {};
  for (const part of zoneParts.formatToParts(instant)) {
    p[part.type] = part.value;
  }
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    midnight:
      p.hour === '00' &&
      p.minute === '00' &&
      p.second === '00' &&
      instant.getUTCMilliseconds() === 0,
  };
}

/**
 * #459. The instant a listing was listed, or null when the feed does not prove it.
 *
 * `listedAt` is `MLSListDate` at midnight UTC (date only). `statusChangedAt` is Bright's
 * `StatusChangeTimestamp`. The status change is a list time only when both hold:
 * - its America/New_York calendar date equals the `MLSListDate` date, and
 * - it is not exactly local midnight, which is a date-only value.
 * A later status change (a price edit, a pending flip) fails the first test. Never invent a time.
 */
export function derivePreciseListedAt(
  listedAt: Date | string | null,
  statusChangedAt: Date | string | null,
): string | null {
  if (listedAt === null || statusChangedAt === null) {
    return null;
  }
  const listed = new Date(listedAt);
  const changed = new Date(statusChangedAt);
  if (Number.isNaN(listed.getTime()) || Number.isNaN(changed.getTime())) {
    return null;
  }
  const local = localParts(changed);
  if (local.midnight || local.date !== listed.toISOString().slice(0, 10)) {
    return null;
  }
  return changed.toISOString();
}
