import { render, screen } from '@testing-library/react';
import { aListingCardRow } from '@/test/fixtures';
import ListingRow from './ListingRow';

jest.mock('@/lib/context', () => ({
  useApp: () => ({ toggleSave: jest.fn(), isSaved: () => false }),
}));

describe('ListingRow', () => {
  it('renders a card per listing row', () => {
    const rows = [
      aListingCardRow({ id: '1', title: 'Row One' }),
      aListingCardRow({ id: '2', title: 'Row Two' }),
    ];

    render(<ListingRow title="Featured" listings={rows} />);

    // Both cards render their office attribution, a reliable per-card marker. Fixture rows are
    // `internal`, so this is the reduced form — see ListingAttribution.
    expect(screen.getAllByText(/Listing courtesy of Real Broker, LLC/)).toHaveLength(2);
  });

  it('renders `max` skeleton placeholders instead of cards when loading, even if listings is non-empty', () => {
    const rows = [aListingCardRow({ id: '1' })];

    const { container } = render(<ListingRow title="Featured" listings={rows} max={4} loading />);

    // No real card content should have rendered while loading.
    expect(screen.queryByText(/Listing courtesy of Real Broker, LLC/)).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-skeleton-card]')).toHaveLength(4);
  });

  it('does not render a "See all" tile while loading, even past the max threshold', () => {
    const rows = Array.from({ length: 10 }, (_, i) => aListingCardRow({ id: String(i) }));

    render(<ListingRow title="Featured" href="/search" listings={rows} max={4} loading />);

    expect(screen.queryByText('See all')).not.toBeInTheDocument();
  });

  it('shows a "See all" tile once listings exceed max', () => {
    const rows = Array.from({ length: 6 }, (_, i) => aListingCardRow({ id: String(i) }));

    render(<ListingRow title="Featured" href="/search" listings={rows} max={4} />);

    expect(screen.getByText('See all')).toBeInTheDocument();
  });

  describe('scroll bounds', () => {
    // jsdom never measures layout, so `scrollWidth`/`clientWidth` stay whatever these getters
    // return. Backing them with a per-element field lets a test set "what the browser would
    // measure" independently of when React's effects happen to run.
    let widths: WeakMap<Element, { scrollWidth: number; clientWidth: number }>;

    beforeAll(() => {
      widths = new WeakMap();
      Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
        configurable: true,
        get() {
          return widths.get(this)?.scrollWidth ?? 0;
        },
      });
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
        configurable: true,
        get() {
          return widths.get(this)?.clientWidth ?? 0;
        },
      });
    });

    it('re-enables "Scroll right" once real, overflowing content replaces a skeleton that fit (#292)', () => {
      const rows = Array.from({ length: 10 }, (_, i) => aListingCardRow({ id: String(i) }));

      const { container, rerender } = render(
        <ListingRow title="Featured" href="/search" listings={[]} max={4} loading />,
      );
      const scroller = container.querySelector('.overflow-x-auto') as HTMLDivElement;

      // The loading skeleton happens to fit the viewport exactly — nothing to scroll to yet.
      widths.set(scroller, { scrollWidth: 400, clientWidth: 400 });
      scroller.dispatchEvent(new Event('scroll'));
      expect(screen.getByLabelText('Scroll right')).toBeDisabled();

      // Real content is wider than the viewport once it replaces the skeleton.
      widths.set(scroller, { scrollWidth: 900, clientWidth: 400 });
      rerender(<ListingRow title="Featured" href="/search" listings={rows} max={4} />);

      expect(screen.getByLabelText('Scroll right')).not.toBeDisabled();
    });
  });
});
