import { render, screen } from '@testing-library/react';
import { aListingCardRow } from '@/test/fixtures';
import { CARD_ACTIVE_CLASS, CARD_HOVER_CLASS } from './cardHover';
import ListingCard from './ListingCard';
import NeighborhoodCard, { SeeAllCard } from './NeighborhoodCard';
import { RESULTS_GRID_GAP_CLASS } from './resultsGridColumns';

jest.mock('@/lib/context', () => ({
  useApp: () => ({ toggleSave: jest.fn(), isSaved: () => false }),
}));
jest.mock('@/lib/useToast', () => ({ useToast: () => ({ toast: jest.fn() }) }));

const HOVER = CARD_HOVER_CLASS.split(' ');
const hasHover = (el: Element | null) =>
  HOVER.every((c) => (el?.className ?? '').split(' ').includes(c));

describe('shared card hover (#526)', () => {
  it('is quiet: a soft shadow, gated on hover-capable devices, with no movement', () => {
    expect(CARD_HOVER_CLASS).toContain('[@media(hover:hover)]:hover:shadow-');
    expect(CARD_HOVER_CLASS).not.toMatch(/translate|scale|shadow-card|hover:bg-/);
  });

  it('is on the listing card', () => {
    const { container } = render(<ListingCard listing={aListingCardRow()} />);

    expect(hasHover(container.querySelector('.listing-card-root'))).toBe(true);
  });

  it('is on the neighborhood card, and the active highlight keeps a dark border', () => {
    const n = { name: 'Petworth', city: 'Washington', state: 'DC', sale: 4, rent: 0 };
    const { container, rerender } = render(<NeighborhoodCard n={n} />);
    expect(hasHover(container.firstElementChild)).toBe(true);

    rerender(<NeighborhoodCard n={n} sync={{ key: 'k', active: true, onActive: jest.fn() }} />);
    const card = container.querySelector('[data-active="true"]');
    expect(hasHover(card)).toBe(true);
    for (const c of CARD_ACTIVE_CLASS.split(' ')) expect(card).toHaveClass(c);
  });

  it('is on the See all tile', () => {
    render(<SeeAllCard href="/x" photos={[]} title="Neighborhoods" />);

    expect(hasHover(screen.getByRole('link'))).toBe(true);
  });

  it('keeps the phone row gap at 16px and the desktop row gap at 48px', () => {
    expect(RESULTS_GRID_GAP_CLASS).toContain('gap-y-4 sm:gap-y-12');
  });
});
