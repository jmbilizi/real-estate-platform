import { homeFeedProfileSchema } from '@cribstop/property-contracts';
import type { FeedRequestProfile } from './feed-profile';
import type { InferredTarget } from './home-target';

/**
 * Flag, bucket and eligibility rules for the personalised home feed (#836).
 *
 * `HOME_FEED_ENABLED` and `HOME_FEED_ROLLOUT_PCT` are server env vars. The home page reads them
 * per request and passes the result to the client component.
 */
export interface HomeFeedFlags {
  enabled: boolean;
  /** Whole percent of visitors in the treatment arm, 0 to 100. */
  rolloutPct: number;
}

export const HOME_FEED_OFF: HomeFeedFlags = { enabled: false, rolloutPct: 0 };

/** Changing the salt re-shuffles every visitor into a new bucket. Change it only for a new experiment. */
export const EXPERIMENT_SALT = 'home-feed-v1';

/** The A/B arm name the client sends. The feed echoes it on every row. */
export const TREATMENT_VARIANT = 'v1';

export function parseHomeFeedFlags(env: {
  HOME_FEED_ENABLED?: string;
  HOME_FEED_ROLLOUT_PCT?: string;
}): HomeFeedFlags {
  const enabled = (env.HOME_FEED_ENABLED ?? 'false').trim().toLowerCase() === 'true';
  const pct = Number((env.HOME_FEED_ROLLOUT_PCT ?? '0').trim());
  const rolloutPct = Number.isFinite(pct) ? Math.min(100, Math.max(0, Math.floor(pct))) : 0;
  return { enabled, rolloutPct };
}

/** 32-bit FNV-1a over the UTF-8 bytes of the string. */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  // `encodeURIComponent` gives the UTF-8 bytes without `TextEncoder`, which jsdom lacks.
  const escaped = encodeURIComponent(input);
  for (let i = 0; i < escaped.length; i++) {
    const byte =
      escaped[i] === '%' ? parseInt(escaped.slice(i + 1, i + 3), 16) : escaped.charCodeAt(i);
    if (escaped[i] === '%') i += 2;
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function bucketOf(anonId: string, salt: string = EXPERIMENT_SALT): number {
  return fnv1a(salt + anonId) % 100;
}

/** True when the visitor is in the treatment arm. No anon id (opt-out, GPC, no storage) means control. */
export function inTreatment(flags: HomeFeedFlags, anonId: string | null): boolean {
  if (!flags.enabled || flags.rolloutPct <= 0 || anonId === null) return false;
  return bucketOf(anonId) < flags.rolloutPct;
}

/** The server's own warm rule (`WARM_VIEWS` in the feed service). Cold visits keep today's rows. */
export function isWarmProfile(profile: FeedRequestProfile | null): boolean {
  if (!profile) return false;
  const views = profile.items.filter((i) => i.kind === 'view').length;
  const saves = profile.items.filter((i) => i.kind === 'save').length;
  return profile.places.length >= 1 || views >= 3 || saves >= 1;
}

/**
 * A feed title names the place. The title rule bans a place derived from IP, geolocation or the
 * market rotation, so only a place the visitor chose or acted on may reach the feed.
 */
const TITLE_SAFE_SOURCES: ReadonlySet<string> = new Set([
  'explicit',
  'last-search',
  'looking-for',
  'saved-home',
  'viewed-homes',
  'visit-views',
]);

export function titleSafeTarget(target: InferredTarget | null): InferredTarget | null {
  return target && TITLE_SAFE_SOURCES.has(target.source) ? target : null;
}

/**
 * Compliance review (#836): "Picked for you" can read as chosen for someone like the visitor, and
 * "your range" can read as profiling by budget. The title states the factual basis instead.
 */
export function feedRowTitle(rowId: string, serverTitle: string): string {
  if (rowId === 'picked') {
    return serverTitle.replace(/^Picked for you in /, 'Based on your activity in ');
  }
  if (rowId === 'price-drops' && serverTitle === 'Price drops in your range') {
    return 'Recent price drops';
  }
  return serverTitle;
}

/** Drops any profile the contract would reject, so one bad stored item never fails the whole request. */
export function validProfile(profile: FeedRequestProfile | null): FeedRequestProfile | null {
  if (!profile) return null;
  return homeFeedProfileSchema.safeParse(profile).success ? profile : null;
}
