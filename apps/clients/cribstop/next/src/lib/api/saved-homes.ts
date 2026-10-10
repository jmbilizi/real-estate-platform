import type { SavedHome, SavedHomesEnvelope, SavedState } from '@cribstop/property-contracts';

/**
 * Client for the saved-homes resource (#23). Like `lib/api/listings.ts`, the browser calls this
 * app's own route handlers, which make the gateway hop server-side.
 */

export class SavedHomesApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'SavedHomesApiError';
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  /** The listing is unknown, deleted or withheld, so the service cannot resolve its home. */
  get isNotFound(): boolean {
    return this.status === 404;
  }
}

const MESSAGE_FOR_STATUS = (status: number): string =>
  status === 401
    ? 'Sign in to save homes.'
    : status === 503
      ? 'Saved homes are briefly unavailable. Please try again.'
      : 'We could not update your saved homes. Please try again.';

async function request<T>(path: string, method: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new SavedHomesApiError(MESSAGE_FOR_STATUS(503), 503);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || body === null) {
    throw new SavedHomesApiError(MESSAGE_FOR_STATUS(res.status), res.ok ? 502 : res.status);
  }
  return body as T;
}

/** Saves the home of a listing. Idempotent. The service resolves listing to home. */
export function saveListing(listingId: string): Promise<SavedState> {
  return request<SavedState>(`/api/listings/${encodeURIComponent(listingId)}/saved`, 'PUT');
}

export function unsaveListing(listingId: string): Promise<SavedState> {
  return request<SavedState>(`/api/listings/${encodeURIComponent(listingId)}/saved`, 'DELETE');
}

/** Unsaves by property id. The only route that reaches an off-market home. */
export function unsaveHomeById(propertyId: string): Promise<SavedState> {
  return request<SavedState>(`/api/saved-homes/${encodeURIComponent(propertyId)}`, 'DELETE');
}

/** The newest saves, newest first. One small read, for surfaces that need only the latest few. */
export async function listRecentSavedHomes(
  limit: number,
  signal?: AbortSignal,
): Promise<SavedHome[]> {
  const envelope = await request<SavedHomesEnvelope>(
    `/api/saved-homes?page=1&pageSize=${limit}`,
    'GET',
    signal,
  );
  return envelope.results;
}

const PAGE_SIZE = 100;
/** A bound on the loop, so a misbehaving total cannot spin the client. */
const MAX_PAGES = 50;

/** Every saved home of the account, home-shaped. Pages through the service's list. */
export async function listAllSavedHomes(signal?: AbortSignal): Promise<SavedHome[]> {
  const homes: SavedHome[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const envelope = await request<SavedHomesEnvelope>(
      `/api/saved-homes?page=${page}&pageSize=${PAGE_SIZE}`,
      'GET',
      signal,
    );
    homes.push(...envelope.results);
    if (page >= envelope.pageCount) break;
  }
  return homes;
}
