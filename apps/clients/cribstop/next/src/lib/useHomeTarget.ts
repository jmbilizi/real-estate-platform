'use client';
import { useEffect, useState } from 'react';
import { addressCity, addressState } from '@/lib/search-place';
import { getLookingFor } from '@/lib/api/looking-for';
import {
  type HomeTarget,
  type LastSearch,
  placeFromLookingFor,
  resolveHomeTarget,
  roundCoordinate,
  type TargetPlace,
} from '@/lib/home-target';

/** Longest wait for a granted position. After it, lower sources decide and a late fix refreshes. */
const GEOLOCATION_WAIT_MS = 4_000;

/** The newest entry of `recentSearches`, the key `CompactSearchBar` writes. */
export function readLastSearch(): LastSearch | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem('recentSearches');
    const parsed = stored ? JSON.parse(stored) : null;
    const entry = Array.isArray(parsed) ? parsed[0] : null;
    if (!entry) return null;
    const address = entry.address ?? {};
    const city = addressCity(address);
    const state = addressState(address);
    if (!city || !state) return null;
    const searchedAt = typeof entry.searchedAt === 'number' ? entry.searchedAt : null;
    return { city, state, searchedAt };
  } catch {
    return null;
  }
}

type Settled<T> = { value: T | null; pending: boolean };

/**
 * The browser position, only when permission is already granted. The home page never opens a
 * permission prompt. The position resolves to a city through the app's reverse lookup, rounded
 * to about 1 km first.
 */
function useGeolocationPlace(): Settled<TargetPlace> {
  const [state, setState] = useState<Settled<TargetPlace>>({ value: null, pending: true });

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const settle = (value: TargetPlace | null) => {
      if (!cancelled) setState({ value, pending: false });
    };

    const run = async () => {
      if (typeof navigator === 'undefined' || !navigator.geolocation || !navigator.permissions) {
        return settle(null);
      }
      try {
        const permission = await navigator.permissions.query({ name: 'geolocation' });
        if (permission.state !== 'granted') return settle(null);
      } catch {
        return settle(null);
      }
      // Lower sources start after the wait. A later fix still replaces them below.
      const waitTimer = setTimeout(() => {
        if (!cancelled) setState((prev) => ({ ...prev, pending: false }));
      }, GEOLOCATION_WAIT_MS);
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          clearTimeout(waitTimer);
          const lat = roundCoordinate(pos.coords.latitude);
          const lon = roundCoordinate(pos.coords.longitude);
          try {
            const res = await fetch(
              `/api/geocode/reverse?lat=${lat}&lon=${lon}&zoom=10&addressdetails=1`,
              { signal: controller.signal },
            );
            const data = res.ok ? await res.json() : null;
            const city = data?.address ? addressCity(data.address) : undefined;
            const st = data?.address ? addressState(data.address) : undefined;
            settle(city && st ? { city, state: st } : null);
          } catch {
            settle(null);
          }
        },
        () => {
          clearTimeout(waitTimer);
          settle(null);
        },
        { maximumAge: 10 * 60_000, timeout: 10_000 },
      );
    };
    void run();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  return state;
}

/** The IP region (#363), fetched once through the app's proxy route. */
function useIpRegion(): Settled<TargetPlace> {
  const [state, setState] = useState<Settled<TargetPlace>>({ value: null, pending: true });
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/geo/region', { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((region: TargetPlace | null) => setState({ value: region, pending: false }))
      .catch(() => setState({ value: null, pending: false }));
    return () => controller.abort();
  }, []);
  return state;
}

/** The first city place of a signed-in visitor's preferences (#768). */
function useLookingForPlace(signedIn: boolean): TargetPlace | null {
  const [place, setPlace] = useState<TargetPlace | null>(null);
  useEffect(() => {
    if (!signedIn) {
      setPlace(null);
      return undefined;
    }
    let cancelled = false;
    getLookingFor()
      .then((list) => !cancelled && setPlace(placeFromLookingFor(list.items)))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [signedIn]);
  return place;
}

export interface HomeTargetState {
  target: HomeTarget | null;
  /** True while no target exists and a source can still give one. Rows show their skeleton. */
  loading: boolean;
}

/**
 * The one place every home row targets. Sources arrive in any order and the target recomputes
 * on each arrival, so a late fix or a late saved read moves the rows to the better place.
 */
export function useHomeTarget(opts: {
  signedIn: boolean;
  savedHome: TargetPlace | null;
}): HomeTargetState {
  const [lastSearch, setLastSearch] = useState<{ value: LastSearch | null; ready: boolean }>({
    value: null,
    ready: false,
  });
  useEffect(() => {
    setLastSearch({ value: readLastSearch(), ready: true });
  }, []);

  const geo = useGeolocationPlace();
  const ip = useIpRegion();
  const lookingFor = useLookingForPlace(opts.signedIn);

  const target = lastSearch.ready
    ? resolveHomeTarget({
        lastSearch: lastSearch.value,
        geolocation: geo.value,
        lookingFor,
        savedHome: opts.savedHome,
        ip: ip.value,
      })
    : null;

  // A granted position outranks IP, so the IP answer waits for it. A last search needs no wait.
  const waiting =
    !lastSearch.ready ||
    (lastSearch.value === null && (geo.pending || (ip.pending && !opts.savedHome && !lookingFor)));
  const gated = target && target.source !== 'last-search' && target.source !== 'geolocation';
  const loading = !target ? waiting : !!gated && geo.pending;

  return { target: loading ? null : target, loading };
}
