import { useEffect, useRef } from 'react';
import { recordRecentlyViewed } from '@/lib/api/recently-viewed';
import { useApp } from '@/lib/context';

/**
 * Sends one view record (#982) when a signed-in visitor opens a listing detail. A re-render or a
 * second effect run for the same visitor and listing sends nothing more. A signed-out visitor
 * sends nothing. Signing in on the open page, or another visitor signing in, sends one call.
 * The email only keys the guard. It never leaves the browser.
 */
export function useRecordRecentlyViewed(listingId: string): void {
  const visitor = useApp().user?.email ?? null;
  const sentFor = useRef<string | null>(null);

  useEffect(() => {
    if (visitor === null) {
      sentFor.current = null;
      return;
    }
    const key = `${visitor}|${listingId}`;
    if (sentFor.current === key) return;
    sentFor.current = key;
    recordRecentlyViewed(listingId);
  }, [visitor, listingId]);
}
