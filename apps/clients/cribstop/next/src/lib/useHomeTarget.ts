'use client';
import { useEffect, useState } from 'react';
import { addressCity, addressState } from '@/lib/search-place';
import { getLookingFor } from '@/lib/api/looking-for';
import {
  CONFIDENCE_MID,
  inferHomeTarget,
  type InferredTarget,
  type LastSearch,
  placeFromLookingFor,
  roundCoordinate,
  sameVisitRefineEnabled,
  fresh as searchIsFresh,
  type TargetPlace,
  type TimedPlace,
} from '@/lib/home-target';
import { getVisitStart, isPersonalisationEnabled, readItems } from '@/lib/feed-profile';
import licensedMarkets from '@/config/licensed-markets.json';

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
    // The wait starts now, so a permission query that never answers cannot hold the rows. A fix
    // that lands later still replaces the lower sources.
    const waitTimer = setTimeout(() => {
      if (!cancelled) setState((prev) => ({ ...prev, pending: false }));
    }, GEOLOCATION_WAIT_MS);
    const settle = (value: TargetPlace | null) => {
      clearTimeout(waitTimer);
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
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
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
        () => settle(null),
        { maximumAge: 10 * 60_000, timeout: 10_000 },
      );
    };
    void run();

    return () => {
      cancelled = true;
      clearTimeout(waitTimer);
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
function useLookingForPlace(signedIn: boolean): Settled<TargetPlace> {
  const [state, setState] = useState<Settled<TargetPlace>>({ value: null, pending: signedIn });
  useEffect(() => {
    if (!signedIn) {
      setState({ value: null, pending: false });
      return undefined;
    }
    let cancelled = false;
    setState((prev) => ({ ...prev, pending: true }));
    getLookingFor()
      .then(
        (list) =>
          !cancelled && setState({ value: placeFromLookingFor(list.items), pending: false }),
      )
      .catch(() => !cancelled && setState({ value: null, pending: false }));
    return () => {
      cancelled = true;
    };
  }, [signedIn]);
  return state;
}

const LOAD_COUNTER_KEY = 'cribstop.homeLoads';

/** A counter in this browser. It rotates the cold-start market. It holds no personal data. */
function nextLoadIndex(): number {
  try {
    const n = Number(window.localStorage.getItem(LOAD_COUNTER_KEY)) || 0;
    window.localStorage.setItem(LOAD_COUNTER_KEY, String(n + 1));
    return n;
  } catch {
    return Math.floor(Date.now() / 1000);
  }
}

interface LocalSignals {
  saved: TimedPlace[];
  viewed: TimedPlace[];
  loadIndex: number;
  visitStart: number;
  refine: boolean;
}

/** Viewed and saved homes of this visitor, from this device. Empty when personalisation is off. */
function readLocalSignals(): LocalSignals {
  const items = isPersonalisationEnabled() ? readItems() : [];
  const place = (i: (typeof items)[number]): TimedPlace => ({
    city: i.city ?? '',
    state: i.state ?? '',
    at: i.at,
  });
  return {
    saved: items.filter((i) => i.kind === 'save').map(place),
    viewed: items.filter((i) => i.kind === 'view').map(place),
    loadIndex: nextLoadIndex(),
    visitStart: getVisitStart(),
    refine: sameVisitRefineEnabled(),
  };
}

export interface HomeTargetState {
  target: InferredTarget | null;
  /** True while a source that could give a better target is still pending. Rows show their skeleton. */
  loading: boolean;
}

/**
 * The one place every home row targets. Sources arrive in any order and the target recomputes
 * on each arrival, so a late fix or a late saved read moves the rows to the better place.
 * The rows wait only for sources that rank above the current winner.
 */
export function useHomeTarget(opts: {
  signedIn: boolean;
  savedHome: TargetPlace | null;
  savedPending: boolean;
}): HomeTargetState {
  const [lastSearch, setLastSearch] = useState<{ value: LastSearch | null; ready: boolean }>({
    value: null,
    ready: false,
  });
  const [local, setLocal] = useState<LocalSignals | null>(null);
  useEffect(() => {
    setLastSearch({ value: readLastSearch(), ready: true });
    setLocal(readLocalSignals());
  }, []);

  const geo = useGeolocationPlace();
  const ip = useIpRegion();
  const lookingFor = useLookingForPlace(opts.signedIn);

  if (!lastSearch.ready || !local) return { target: null, loading: true };

  const target = inferHomeTarget({
    lastSearch: lastSearch.value,
    geolocation: geo.value,
    lookingFor: lookingFor.value,
    savedPlaces: [...local.saved, ...(opts.savedHome ? [opts.savedHome] : [])],
    viewedPlaces: local.viewed,
    ip: ip.value,
    markets: licensedMarkets,
    loadIndex: local.loadIndex,
    visitStart: local.visitStart,
    sameVisitRefine: local.refine,
  });

  // Pending flags in precedence order, after the last search (which is already read).
  const pendingByRank: [InferredTarget['source'], boolean][] = [
    ['geolocation', geo.pending],
    ['looking-for', lookingFor.pending],
    ['saved-home', opts.savedPending],
    ['ip', ip.pending],
  ];
  const order = [
    'explicit',
    'visit-views',
    'last-search',
    'geolocation',
    'looking-for',
    'saved-home',
    'viewed-homes',
    'ip',
    'default',
    'rotation',
  ];
  const winnerRank = target ? order.indexOf(target.source) : order.length;
  // A weak winner, or one from views alone, also waits for a pending source. A stale search,
  // the cold-start rotation or a few views then do not flash before a better source arrives.
  // A search or position the visitor gave never waits.
  const precedence =
    target?.source === 'explicit' ||
    target?.source === 'geolocation' ||
    target?.source === 'visit-views' ||
    (target?.source === 'last-search' &&
      !!lastSearch.value &&
      searchIsFresh(lastSearch.value, Date.now()));
  const weak =
    !target ||
    target.source === 'viewed-homes' ||
    (target.confidence < CONFIDENCE_MID && !precedence);
  const loading = pendingByRank.some(
    ([source, pending]) => pending && (weak || order.indexOf(source) < winnerRank),
  );

  return { target: loading ? null : target, loading };
}
