/**
 * Local feed profile (#833). It holds the last viewed or saved listings. It stays in this
 * browser. The only way out is the body of the feed request (`getFeedRequestProfile`). Never log it.
 *
 * Places come from the existing `recentSearches` store. This module never copies them.
 */

export const FEED_PROFILE_KEY = 'cribstop.feedProfile.v1';
export const PERSONALISE_KEY = 'cribstop.personalise';
export const PERSONALISE_EVENT = 'cribstop:personalise-change';
export const MAX_PROFILE_ITEMS = 50;
export const MAX_PROFILE_PLACES = 5;

export type FeedSide = 'sale' | 'rent';
export type FeedItemKind = 'view' | 'save';

export interface FeedProfileItem {
  listingId: string;
  kind: FeedItemKind;
  side: FeedSide;
  at: number;
}

export interface FeedRequestProfile {
  items: FeedProfileItem[];
  places: string[];
}

/** Global Privacy Control: a browser-level opt-out signal. */
export function isGpcOn(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true
  );
}

/** True unless GPC is on or the visitor turned the switch off. */
export function isPersonalisationEnabled(): boolean {
  if (typeof window === 'undefined' || isGpcOn()) return false;
  try {
    return window.localStorage.getItem(PERSONALISE_KEY) !== 'off';
  } catch {
    // Fail closed: if the opt-out cannot be read, do not personalise.
    return false;
  }
}

/** Turning off also deletes the stored profile. */
export function setPersonalisation(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (enabled) window.localStorage.removeItem(PERSONALISE_KEY);
    else {
      window.localStorage.setItem(PERSONALISE_KEY, 'off');
      clearFeedProfile();
    }
  } catch {
    // Storage is blocked. There is nothing to write or clear.
  }
  window.dispatchEvent(new Event(PERSONALISE_EVENT));
}

function isItem(v: any): v is FeedProfileItem {
  return (
    v &&
    typeof v.listingId === 'string' &&
    (v.kind === 'view' || v.kind === 'save') &&
    (v.side === 'sale' || v.side === 'rent') &&
    typeof v.at === 'number'
  );
}

function readItems(): FeedProfileItem[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(FEED_PROFILE_KEY) ?? 'null');
    return Array.isArray(parsed?.items) ? parsed.items.filter(isItem) : [];
  } catch {
    return [];
  }
}

/** Newest first. A listing keeps one entry. A save outranks a view of the same listing. */
export function recordFeedItem(
  listingId: string,
  kind: FeedItemKind,
  side: FeedSide = 'sale',
  now: number = Date.now(),
): void {
  if (!listingId || !isPersonalisationEnabled()) return;
  try {
    const existing = readItems();
    const wasSaved = existing.some((i) => i.listingId === listingId && i.kind === 'save');
    const items = [
      { listingId, kind: wasSaved ? 'save' : kind, side, at: now } as FeedProfileItem,
      ...existing.filter((i) => i.listingId !== listingId),
    ].slice(0, MAX_PROFILE_ITEMS);
    window.localStorage.setItem(FEED_PROFILE_KEY, JSON.stringify({ v: 1, items }));
  } catch {
    // A full or blocked store must not affect the page.
  }
}

export function clearFeedProfile(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(FEED_PROFILE_KEY);
  } catch {
    // Nothing to clear.
  }
}

function readPlaces(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem('recentSearches') ?? 'null');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((s) => s?.display_name)
      .filter((n): n is string => typeof n === 'string' && n.length > 0)
      .slice(0, MAX_PROFILE_PLACES);
  } catch {
    return [];
  }
}

/** The profile for the feed request body. Null when personalisation is off: send nothing. */
export function getFeedRequestProfile(): FeedRequestProfile | null {
  if (!isPersonalisationEnabled()) return null;
  return { items: readItems(), places: readPlaces() };
}
