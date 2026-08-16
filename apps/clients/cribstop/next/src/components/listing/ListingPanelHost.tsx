'use client';

import { useEffect } from 'react';
import ListingDetailModal from '@/components/ListingDetailModal';
import {
  closeListingPanel,
  syncListingPanelToLocation,
  useListingPanel,
} from '@/lib/listing-panel';

/**
 * The single mount point for a softly-opened listing panel.
 *
 * It lives in the root layout for one reason: whatever renders this has to already be in the
 * browser's memory when the click happens. That is the whole fix — the panel it replaces was a
 * route segment, so opening it meant fetching a payload and then a chunk before anything could be
 * drawn. Mounting from the root layout puts the panel's code in the bundle every page already
 * loaded, so opening is a state change and nothing else.
 *
 * The weight that buys is modest and worth checking if it ever grows: `ListingDetailContent` pulls
 * in the gallery, the amenity chips and the mortgage teaser, but **not** leaflet — both maps sit
 * behind `next/dynamic`, so the map chunk is still fetched only when a listing is actually open.
 *
 * Renders nothing at all until something opens a listing, so it costs no HTML on the server and no
 * DOM on a page nobody has opened a listing from.
 */
export default function ListingPanelHost() {
  const panel = useListingPanel();

  useEffect(() => {
    /*
     * Back and Forward are the only way the address bar can move underneath this panel — the open
     * itself goes through `openListingPanel`, which sets the store first — so `popstate` is the one
     * event that has to be reconciled. It is also how closing finishes: `closeListingPanel` steps
     * back, and the handler below is what takes the panel off the screen in response.
     */
    window.addEventListener('popstate', syncListingPanelToLocation);
    return () => window.removeEventListener('popstate', syncListingPanelToLocation);
  }, []);

  if (!panel) return null;

  /*
   * Keyed on the listing, so opening a second listing from the first one's "similar homes" row
   * remounts rather than re-using the open panel's state. Without the key the new listing would
   * inherit the previous one's resolved state and show the wrong home for a frame.
   */
  return (
    <ListingDetailModal
      key={panel.id}
      id={panel.id}
      layoutRow={panel.row}
      onClosed={closeListingPanel}
    />
  );
}
