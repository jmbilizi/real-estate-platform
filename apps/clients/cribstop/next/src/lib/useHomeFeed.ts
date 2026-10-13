'use client';

import { useEffect, useState } from 'react';
import type { HomeFeedResponse } from '@cribstop/property-contracts';
import { getHomeFeed } from '@/lib/api/home-feed';
import { getAnonId } from '@/lib/anon-id';
import { getFeedRequestProfile } from '@/lib/feed-profile';
import {
  type HomeFeedFlags,
  inTreatment,
  isWarmProfile,
  titleSafeTarget,
  TREATMENT_VARIANT,
  validProfile,
} from '@/lib/home-feed';
import type { InferredTarget } from '@/lib/home-target';

export const FEED_TIMEOUT_MS = 4_000;

/**
 * `off`: today's rows. `pending`: the feed skeleton shows. `ready`: feed rows show.
 * An error, an empty answer or `variant: fallback` all end in `off`.
 */
export type HomeFeedState =
  | { status: 'off' }
  | { status: 'pending' }
  | { status: 'ready'; feed: HomeFeedResponse };

function armOf(flags: HomeFeedFlags): 'control' | 'treatment' {
  try {
    return inTreatment(flags, getAnonId()) ? 'treatment' : 'control';
  } catch {
    return 'control';
  }
}

/**
 * The A/B gate and the feed read (#836). Every state but a started fetch shows today's rows, so
 * the flag-off path, the control arm and the server render are identical to the page before the
 * feed. The flag-off path never touches storage or the network.
 */
export function useHomeFeed(
  flags: HomeFeedFlags,
  region: InferredTarget | null,
  regionLoading: boolean,
  side: 'sale' | 'rent',
): HomeFeedState {
  const live = flags.enabled && flags.rolloutPct > 0;
  const [arm, setArm] = useState<'unknown' | 'control' | 'treatment'>(live ? 'unknown' : 'control');
  const [state, setState] = useState<HomeFeedState>({ status: 'off' });

  useEffect(() => {
    if (live) setArm(armOf(flags));
  }, [live, flags]);

  const radiusKm = region?.radiusKm == null ? null : Math.min(100, Math.max(1, region.radiusKm));
  const regionKey = region ? `${region.city}|${region.state}|${region.source}|${radiusKm}` : '';

  useEffect(() => {
    if (!live || arm !== 'treatment' || regionLoading) {
      setState({ status: 'off' });
      return undefined;
    }
    const target = titleSafeTarget(region);
    const profile = validProfile(getFeedRequestProfile());
    if (!target || !isWarmProfile(profile)) {
      setState({ status: 'off' });
      return undefined;
    }
    // `stale` marks a run its own cleanup ended. A timeout abort is not stale: it ends in `off`.
    let stale = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
    setState({ status: 'pending' });
    getHomeFeed(
      {
        profile,
        target: { city: target.city, state: target.state },
        radiusKm,
        side,
        variant: TREATMENT_VARIANT,
      },
      controller.signal,
    )
      .then((feed) => {
        if (stale) return;
        const usable = feed.variant !== 'fallback' && feed.rows.some((r) => r.listings.length > 0);
        setState(usable ? { status: 'ready', feed } : { status: 'off' });
      })
      .catch(() => {
        if (!stale) setState({ status: 'off' });
      })
      .finally(() => clearTimeout(timer));
    return () => {
      stale = true;
      clearTimeout(timer);
      controller.abort();
    };
    // `region` is keyed by place, source and radius, so a new object for the same place never refetches.
  }, [live, arm, regionKey, regionLoading, side]);

  return live ? state : { status: 'off' };
}
