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

    // Both cards render their attribution line, which is a reliable per-card marker.
    expect(screen.getAllByText(/Listing courtesy of/)).toHaveLength(2);
  });

  it('renders `max` skeleton placeholders instead of cards when loading, even if listings is non-empty', () => {
    const rows = [aListingCardRow({ id: '1' })];

    const { container } = render(<ListingRow title="Featured" listings={rows} max={4} loading />);

    // No real card content should have rendered while loading.
    expect(screen.queryByText(/Listing courtesy of/)).not.toBeInTheDocument();
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(4);
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
});
