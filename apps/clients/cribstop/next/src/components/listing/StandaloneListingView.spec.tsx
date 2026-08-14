import { act, render, screen } from '@testing-library/react';
import { aListingDetail } from '@/test/fixtures';
import { toListingDetailView } from '@/lib/api/listings';
import StandaloneListingView from './StandaloneListingView';

const push = jest.fn();
let pathname = '/listing/11111111-1111-4111-8111-111111111111';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, prefetch: jest.fn(), back: jest.fn() }),
  usePathname: () => pathname,
}));

// The results themselves are not what this suite is about — the backdrop's own wiring is — so a stub
// keeps these tests off leaflet, the geocode calls and the search fetch.
jest.mock('@/components/SearchExperience', () => ({
  __esModule: true,
  default: ({ ownsUrl }: { ownsUrl?: boolean }) => (
    <div data-testid="search-results" data-owns-url={String(ownsUrl)} />
  ),
}));

jest.mock('@/components/ListingDetailContent', () => ({
  __esModule: true,
  default: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>Close listing</button>
  ),
}));

const CITY_QUERY = 'q=Alexandria%2C%20VA';
const ID = '11111111-1111-4111-8111-111111111111';

const readyState = () => ({
  status: 'ready' as const,
  listing: toListingDetailView(aListingDetail()),
});

/** The panel animates out before closing completes, so tests have to get past that timer. */
const closeThePanel = async () => {
  await act(async () => {
    screen.getByText('Close listing').click();
  });
  await act(async () => {
    jest.advanceTimersByTime(400);
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  push.mockReset();
  pathname = `/listing/${ID}`;
  window.history.replaceState(null, '', `/listing/${ID}`);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('StandaloneListingView', () => {
  it('mounts the results behind the panel, inert and not owning the URL', async () => {
    render(<StandaloneListingView id={ID} initialState={readyState()} cityQuery={CITY_QUERY} />);

    // The backdrop mounts from a double rAF so it cannot compete with the listing.
    await act(async () => {
      jest.advanceTimersByTime(100);
    });

    const backdrop = document.querySelector('[data-search-backdrop]');
    expect(backdrop).toHaveAttribute('data-search-backdrop', 'inert');
    expect(backdrop).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('search-results')).toHaveAttribute('data-owns-url', 'false');
  });

  it('reveals the results it already rendered instead of navigating to them', async () => {
    render(<StandaloneListingView id={ID} initialState={readyState()} cityQuery={CITY_QUERY} />);
    await act(async () => {
      jest.advanceTimersByTime(100);
    });

    const before = screen.getByTestId('search-results');
    pathname = '/search';
    await closeThePanel();

    // The point of the whole arrangement: no navigation, so the results are never rebuilt.
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByTestId('search-results')).toBe(before);

    // ...and they become the page: interactive, and now owning the URL.
    expect(document.querySelector('[data-search-backdrop]')).toHaveAttribute(
      'data-search-backdrop',
      'live',
    );
    expect(screen.getByTestId('search-results')).toHaveAttribute('data-owns-url', 'true');
    expect(window.location.pathname + window.location.search).toBe('/search?q=Alexandria%2C%20VA');
  });

  it('navigates only when there is no city behind the panel to reveal', async () => {
    render(
      <StandaloneListingView
        id={ID}
        initialState={{ status: 'error', message: 'nope' }}
        cityQuery={null}
      />,
    );

    expect(document.querySelector('[data-search-backdrop]')).toBeNull();
  });
});
