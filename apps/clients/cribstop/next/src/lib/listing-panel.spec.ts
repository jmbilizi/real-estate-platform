import { aListingCardRow } from '@/test/fixtures';
import {
  closeListingPanel,
  getListingPanel,
  listingIdFromPath,
  openListingPanel,
  resetListingPanel,
  syncListingPanelToLocation,
} from './listing-panel';

/**
 * The store behind an instant listing open.
 *
 * These cases exist because the thing being asserted is a *timing* property that no type can
 * express: opening a listing must not depend on the network. The panel used to be a route segment,
 * so opening it fetched an RSC payload and a chunk before anything could be drawn — measured at
 * 519ms of blank screen after the click, which is what made users click a second time.
 */
describe('listing panel store', () => {
  beforeEach(() => {
    resetListingPanel();
    window.history.replaceState(null, '', '/search?q=Bethesda%2C+MD');
  });

  describe('listingIdFromPath', () => {
    it('reads the id out of a listing pathname', () => {
      expect(listingIdFromPath('/listing/abc-123')).toBe('abc-123');
      expect(listingIdFromPath('/listing/abc-123/')).toBe('abc-123');
    });

    it('is null for anything that is not a listing, so no other route can open a panel', () => {
      expect(listingIdFromPath('/search')).toBeNull();
      expect(listingIdFromPath('/')).toBeNull();
      expect(listingIdFromPath('/listing')).toBeNull();
      // Guards the popstate handler against a deeper future route being mistaken for a listing.
      expect(listingIdFromPath('/listing/abc-123/photos')).toBeNull();
    });
  });

  it('opens synchronously, before any await — the open cannot be gated on a request', () => {
    const row = aListingCardRow({ id: 'listing-1' });

    openListingPanel('listing-1', row);

    // Read back in the same tick as the call: no promise, no timer, no microtask in between.
    expect(getListingPanel()).toEqual({ id: 'listing-1', row });
  });

  it('moves the URL to the listing without a navigation, so the page underneath stays mounted', () => {
    openListingPanel('listing-1', aListingCardRow({ id: 'listing-1' }));

    expect(window.location.pathname).toBe('/listing/listing-1');
  });

  it('keeps the row, which is what lets the panel open on the listing instead of on grey blocks', () => {
    const row = aListingCardRow({ id: 'listing-1', address: '12 Main St' });

    openListingPanel('listing-1', row);

    expect(getListingPanel()?.row?.address).toBe('12 Main St');
  });

  it('opens without a row when there is none to hand, rather than refusing to open', () => {
    openListingPanel('listing-1');

    expect(getListingPanel()).toEqual({ id: 'listing-1', row: undefined });
  });

  it('closes by stepping back, so the address bar and the panel can never disagree', () => {
    const back = jest.spyOn(window.history, 'back').mockImplementation(() => {});

    closeListingPanel();

    expect(back).toHaveBeenCalled();
    back.mockRestore();
  });

  describe('browser Back and Forward', () => {
    it('clears the panel when the pathname is no longer a listing', () => {
      openListingPanel('listing-1', aListingCardRow({ id: 'listing-1' }));
      window.history.replaceState(null, '', '/search?q=Bethesda%2C+MD');

      syncListingPanelToLocation();

      expect(getListingPanel()).toBeNull();
    });

    it('re-opens a listing this document opened, with its row, on a forward navigation', () => {
      const row = aListingCardRow({ id: 'listing-1' });
      openListingPanel('listing-1', row);
      window.history.replaceState(null, '', '/search?q=Bethesda%2C+MD');
      syncListingPanelToLocation();

      window.history.replaceState(null, '', '/listing/listing-1');
      syncListingPanelToLocation();

      expect(getListingPanel()).toEqual({ id: 'listing-1', row });
    });

    /**
     * The guard that keeps this store off the standalone route's territory.
     *
     * `/listing/<id>` reached any other way — a shared link, a bookmark, a reload — is rendered by
     * `StandaloneListingView`, which brings its own panel. Opening one here as well would put two
     * `Modal`s on screen at once, and two `bg-black/30` backdrops read as the page going dark.
     */
    it('does not open a panel for a listing URL it never opened itself', () => {
      window.history.replaceState(null, '', '/listing/never-opened-here');

      syncListingPanelToLocation();

      expect(getListingPanel()).toBeNull();
    });
  });
});
