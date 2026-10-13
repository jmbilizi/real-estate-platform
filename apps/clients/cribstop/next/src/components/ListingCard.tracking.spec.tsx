import { act, fireEvent, render, screen } from '@testing-library/react';
import { aListingCardRow } from '@/test/fixtures';
import { installFakeIntersectionObserver, setVisibleRatio } from '@/test/intersection';
import { resetImpressions } from '@/lib/useImpression';
import { resetListingPanel } from '@/lib/listing-panel';
import ListingCard from './ListingCard';

jest.mock('@/lib/context', () => ({
  useApp: () => ({ toggleSave: jest.fn(), isSaved: () => false }),
}));
jest.mock('@/lib/useToast', () => ({ useToast: () => ({ toast: jest.fn() }) }));

const mockTrackEvent = jest.fn();
jest.mock('@/lib/analytics', () => ({
  ...jest.requireActual('@/lib/analytics'),
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}));

const track = { listType: 'grid', rowId: 'near-you', position: 2 } as const;
const names = () => mockTrackEvent.mock.calls.map(([name]) => name as string);

describe('ListingCard analytics (#826)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockTrackEvent.mockReset();
    installFakeIntersectionObserver();
    resetImpressions();
    resetListingPanel();
  });
  afterEach(() => jest.useRealTimers());

  function seen() {
    act(() => setVisibleRatio(0.6));
    act(() => void jest.advanceTimersByTime(1000));
  }

  it('sends one listing_impression with row and position at 50% for 1 second', () => {
    const listing = aListingCardRow();
    const { rerender } = render(<ListingCard listing={listing} track={track} />);
    seen();
    rerender(<ListingCard listing={{ ...listing }} track={track} />);
    seen();
    expect(mockTrackEvent).toHaveBeenCalledTimes(1);
    expect(mockTrackEvent).toHaveBeenCalledWith('listing_impression', {
      listingId: listing.id,
      props: { row_id: 'near-you', card_position: 2, list_type: 'grid' },
    });
  });

  it('sends listing_click when the card opens', () => {
    const listing = aListingCardRow();
    render(<ListingCard listing={listing} track={track} />);
    fireEvent.click(screen.getByRole('link', { name: /View listing at/ }));
    expect(mockTrackEvent).toHaveBeenCalledWith('listing_click', {
      listingId: listing.id,
      props: { row_id: 'near-you', card_position: 2, target: 'card' },
    });
  });

  it('sends listing_share when the link is copied', async () => {
    jest.useRealTimers();
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const listing = aListingCardRow();
    render(<ListingCard listing={listing} track={track} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Share this listing' }));
    });
    expect(mockTrackEvent).toHaveBeenCalledWith('listing_share', {
      listingId: listing.id,
      props: { channel: 'copy' },
    });
    expect(names()).not.toContain('listing_click');
  });

  it('sends feed_impression and feed_click only for a feed row', () => {
    const listing = aListingCardRow();
    const feed = { variant: 'ranked-a', modelVersion: 'm1', explore: false };
    render(<ListingCard listing={listing} track={{ ...track, feed }} />);
    seen();
    fireEvent.click(screen.getByRole('link', { name: /View listing at/ }));
    const feedBody = {
      listingId: listing.id,
      props: {
        row_id: 'near-you',
        position: 2,
        variant: 'ranked-a',
        model_version: 'm1',
        explore: false,
      },
    };
    expect(mockTrackEvent).toHaveBeenCalledWith('feed_impression', feedBody);
    expect(mockTrackEvent).toHaveBeenCalledWith('feed_click', feedBody);
  });

  it('sends no feed event for a flag-off row, and nothing for a card with no track', () => {
    const listing = aListingCardRow();
    render(<ListingCard listing={listing} track={track} />);
    seen();
    fireEvent.click(screen.getByRole('link', { name: /View listing at/ }));
    expect(names().filter((n) => n.startsWith('feed_'))).toEqual([]);
    mockTrackEvent.mockReset();
    render(<ListingCard listing={aListingCardRow({ id: 'other' })} />);
    seen();
    expect(mockTrackEvent).not.toHaveBeenCalled();
  });
});
