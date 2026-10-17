import type { QueryClient } from '@tanstack/react-query';
import { SAVED_MUTATION_KEY, savedKeys } from './saved-homes';

export const SAVED_CHANNEL = 'cribstop-saved-homes';
export const SAVED_STORAGE_KEY = 'cribstop-saved-homes-sync';

/** A message tells another tab to refetch. It never carries saved homes or an email. */
export interface SavedTabMessage {
  type: 'invalidate' | 'logout';
  /** Opaque marker of the account. Compare for equality only. */
  marker: string;
}

export interface TabChannel {
  postMessage(message: SavedTabMessage): void;
  addEventListener(type: 'message', listener: (e: { data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (e: { data: unknown }) => void): void;
  close(): void;
}

export interface SavedTabSync {
  announceLogout(): void;
  stop(): void;
}

/** Hash of the account email. The email stays in this tab. Returns null where Web Crypto is absent. */
export async function accountMarker(email: string): Promise<string | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null;
  const bytes = new TextEncoder().encode(`saved-homes:${email.toLowerCase()}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function isMessage(data: unknown): data is SavedTabMessage {
  if (typeof data !== 'object' || data === null) return false;
  const m = data as Partial<SavedTabMessage>;
  return (m.type === 'invalidate' || m.type === 'logout') && typeof m.marker === 'string';
}

interface Options {
  client: QueryClient;
  marker: string;
  /** Pass null where `BroadcastChannel` is absent. The `storage` event then carries the signal. */
  channel: TabChannel | null;
  /** Pass null to turn the `storage` fallback off. */
  win: Pick<Window, 'addEventListener' | 'removeEventListener' | 'localStorage'> | null;
}

function refresh(client: QueryClient) {
  return client.invalidateQueries({ queryKey: savedKeys.all });
}

/**
 * Keeps saved homes in step across tabs of one signed-in user (#912).
 * A finished save or unsave in this tab tells the other tabs to refetch. The other tabs fetch
 * their own data, so nothing is copied across. Another user's message is ignored. A logout empties
 * the saved homes in the other tabs. The `storage` fallback writes a timestamp only. It has no
 * account marker, so it can only invalidate. A needless refetch is harmless.
 */
export function startSavedTabSync({ client, marker, channel, win }: Options): SavedTabSync {
  const onMessage = (e: { data: unknown }) => {
    if (!isMessage(e.data) || e.data.marker !== marker) return;
    if (e.data.type === 'logout') client.setQueryData(savedKeys.ids, []);
    void refresh(client);
  };
  channel?.addEventListener('message', onMessage);

  const onStorage = (e: Event) => {
    if ((e as StorageEvent).key === SAVED_STORAGE_KEY) void refresh(client);
  };
  if (!channel) win?.addEventListener('storage', onStorage);

  const announce = (type: SavedTabMessage['type']) => {
    if (channel) {
      channel.postMessage({ type, marker });
      return;
    }
    try {
      win?.localStorage.setItem(SAVED_STORAGE_KEY, String(Date.now()));
    } catch {
      // Storage is blocked. The other tabs refresh on their next focus.
    }
  };

  const unsubscribe = client.getMutationCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') return;
    const key = event.mutation.options.mutationKey;
    if (key?.[0] !== SAVED_MUTATION_KEY[0]) return;
    // A signed-out toggle sends nothing to the server, so there is nothing to refetch.
    if ((event.mutation.state.variables as { signedIn?: boolean } | undefined)?.signedIn) {
      announce('invalidate');
    }
  });

  return {
    announceLogout: () => announce('logout'),
    stop: () => {
      unsubscribe();
      channel?.removeEventListener('message', onMessage);
      win?.removeEventListener('storage', onStorage);
      channel?.close();
    },
  };
}
