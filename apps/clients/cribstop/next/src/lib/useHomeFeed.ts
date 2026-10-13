'use client';

import { useEffect, useRef, useState } from 'react';
import type { HomeFeedResponse } from '@cribstop/property-contracts';
import { getHomeFeed } from '@/lib/api/home-feed';
import { getAnonId } from '@/lib/anon-id';
import { getFeedRequestProfile } from '@/lib/feed-profile';
import {
  HOME_FEED_OFF,
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
/** Scrolled this far, the visitor is reading. A late swap would move the page under them. */
export const SWAP_MAX_SCROLL_PX = 80;

/** Reads the runtime flags. Off until they arrive, and off on any failure. */
function useFeedFlags(override: HomeFeedFlags | undefined): HomeFeedFlags {
  const [flags, setFlags] = useState<HomeFeedFlags>(override ?? HOME_FEED_OFF);
  useEffect(() => {
    if (override || typeof fetch !== 'function') return undefined;
    const controller = new AbortController();
    fetch('/api/feed-config', { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: unknown) => {
        const b = body as Partial<HomeFeedFlags> | null;
        if (b && b.enabled === true && typeof b.rolloutPct === 'number') {
          setFlags({
            enabled: true,
            rolloutPct: Math.min(100, Math.max(0, Math.floor(b.rolloutPct))),
          });
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [override]);
  return override ?? flags;
}

/** True once the visitor touched, pressed a key or scrolled the page. */
function useInteracted(): () => boolean {
  const touched = useRef(false);
  useEffect(() => {
    const mark = () => {
      touched.current = true;
    };
    const events = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;
    events.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, mark));
  }, []);
  return () => touched.current || window.scrollY > SWAP_MAX_SCROLL_PX;
}

export function useHomeFeed(
  flagsOverride: HomeFeedFlags | undefined,
  region: InferredTarget | null,
  regionLoading: boolean,
  side: 'sale' | 'rent',
): HomeFeedState {
  const flags = useFeedFlags(flagsOverride);
  const busy = useInteracted();
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
    // A visitor who already scrolled or touched the page keeps today's rows.
    if (busy()) {
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
