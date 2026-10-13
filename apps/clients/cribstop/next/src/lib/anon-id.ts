import { ANON_ID_KEY, isPersonalisationEnabled } from './feed-profile';

/**
 * The anonymous id (#825): a random 128-bit code in first-party localStorage. It rotates after
 * 13 months and never leaves this domain except in the body of an analytics event.
 *
 * Opt-out (footer switch or Global Privacy Control) deletes it. While opted out, or when storage
 * is blocked, there is no id and the caller sends nothing. A/B bucketing uses this id, never the
 * session id.
 */
export const ANON_ID_MAX_AGE_MS = 13 * 30 * 24 * 60 * 60 * 1000;

let createdThisLoad = false;

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The id, or null when the visitor opted out or storage is unavailable. */
export function getAnonId(now: number = Date.now()): string | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!isPersonalisationEnabled()) {
      window.localStorage.removeItem(ANON_ID_KEY);
      return null;
    }
    const stored = JSON.parse(window.localStorage.getItem(ANON_ID_KEY) ?? 'null');
    if (
      stored &&
      typeof stored.id === 'string' &&
      /^[a-f0-9]{32}$/.test(stored.id) &&
      typeof stored.at === 'number' &&
      now - stored.at < ANON_ID_MAX_AGE_MS
    ) {
      return stored.id;
    }
    const id = randomId();
    window.localStorage.setItem(ANON_ID_KEY, JSON.stringify({ id, at: now }));
    createdThisLoad = true;
    return id;
  } catch {
    return null;
  }
}

/** True when this page load made the id. Used for `is_new_anon` on `session_start`. */
export function isNewAnonId(): boolean {
  return createdThisLoad;
}
