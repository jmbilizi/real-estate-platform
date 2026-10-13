'use client';

import { useEffect, useRef, useState } from 'react';
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

/**
 * The A/B gate and the feed read (#836). The flag-off path never touches storage or the network,
 * so the page renders exactly as before.
 */
export function useHomeFeed(
  flags: HomeFeedFlags,
  region: InferredTarget | null,
  regionLoading: boolean,
  side: 'sale' | 'rent',
): HomeFeedState {
  const live = flags.enabled && flags.rolloutPct > 0;
  const [arm, setArm] = useState<'unknown' | 'control' | 'treatment'>(live ? 'unknown' : 'control');
  const [state, setState] = useState<HomeFeedState>({ status: live ? 'pending' : 'off' });
  const generation = useRef(0);

  useEffect(() => {
    if (!live) return;
    setArm(inTreatment(flags, getAnonId()) ? 'treatment' : 'control');
  }, [live, flags]);

  const regionKey = region ? `${region.city}|${region.state}|${region.source}` : '';

  useEffect(() => {
    if (!live) return undefined;
    if (arm === 'control') {
      setState({ status: 'off' });
      return undefined;
    }
    if (arm === 'unknown' || regionLoading) {
      setState({ status: 'pending' });
      return undefined;
    }
    const target = titleSafeTarget(region);
    const profile = validProfile(getFeedRequestProfile());
    if (!target || !isWarmProfile(profile)) {
      setState({ status: 'off' });
      return undefined;
    }
    const mine = ++generation.current;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
    setState({ status: 'pending' });
    getHomeFeed(
      {
        profile,
        target: { city: target.city, state: target.state },
        radiusKm: target.radiusKm,
        side,
        variant: TREATMENT_VARIANT,
      },
      controller.signal,
    )
      .then((feed) => {
        if (generation.current !== mine) return;
        const usable = feed.variant !== 'fallback' && feed.rows.some((r) => r.listings.length > 0);
        setState(usable ? { status: 'ready', feed } : { status: 'off' });
      })
      .catch(() => {
        if (generation.current !== mine) return;
        setState({ status: 'off' });
      })
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `region` is keyed by place and source, so a new object for the same place never refetches.
  }, [live, arm, regionKey, regionLoading, side]);

  return live ? state : { status: 'off' };
}
