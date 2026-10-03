import { render, screen } from '@testing-library/react';
import { aListingCardRow } from '@/test/fixtures';
import { CARD_ACTIVE_CLASS, CARD_HOVER_CLASS } from './cardHover';
import { CAROUSEL_SCROLLER_CLASS } from './CarouselShell';
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
  it('is a quiet halo overlay, gated on hover-capable devices, with no movement', () => {
    expect(CARD_HOVER_CLASS).toContain('[@media(hover:hover)]:hover:before:shadow-');
    expect(CARD_HOVER_CLASS).not.toMatch(/translate|scale|shadow-card/);
    // Every hover class acts on the overlay, never on the card box itself.
    for (const c of HOVER.filter((x) => x.includes('hover:'))) expect(c).toContain('before:');
  });

  it('is an overlay behind the content that cannot change the layout box (#550)', () => {
    for (const c of [
      'relative',
      'isolate',
      'before:absolute',
      'before:-inset-2',
      'before:-z-10',
      'before:rounded-lg',
      'before:pointer-events-none',
    ]) {
      expect(HOVER).toContain(c);
    }
    // No class may change the card's own box: no padding, margin, border, size or outline offset.
    expect(
      HOVER.filter((c) => !c.includes('before:') && /^(-?[mp][trblxy]?-|border|w-|h-)/.test(c)),
    ).toEqual([]);
  });

  it('keeps the carousel scroller padded so the halo is not clipped (#550)', () => {
    const classes = CAROUSEL_SCROLLER_CLASS.split(' ');
    for (const c of ['pt-2.5', '-ml-3', 'pl-3', 'sm:-mr-3', 'sm:pr-3'])
      expect(classes).toContain(c);
  });

  it('is on the listing card', () => {
    const { container } = render(<ListingCard listing={aListingCardRow()} />);

    expect(hasHover(container.querySelector('.listing-card-root'))).toBe(true);
  });

  it('is on the neighborhood card, and the active highlight keeps a dark border', () => {
    const n = { name: 'Petworth', city: 'Washington', state: 'DC', sale: 4, rent: 0 };
    const { container, rerender } = render(<NeighborhoodCard n={n} />);
    expect(hasHover(container.firstElementChild)).toBe(true);

    const homeClass = (container.firstElementChild as HTMLElement).className;

    // Synced but not highlighted (card hover in search): the home card classes exactly (#540).
    rerender(<NeighborhoodCard n={n} sync={{ key: 'k', onActive: jest.fn() }} />);
    expect((container.firstElementChild as HTMLElement).className).toBe(homeClass);

    rerender(<NeighborhoodCard n={n} sync={{ key: 'k', onActive: jest.fn() }} highlighted />);
    const card = container.querySelector('[data-active="true"]');
    expect(hasHover(card)).toBe(true);
    for (const c of CARD_ACTIVE_CLASS.split(' ')) expect(card).toHaveClass(c);
  });

  it('is on the See all tile', () => {
    render(<SeeAllCard href="/x" photos={[]} title="Neighborhoods" />);

    expect(hasHover(screen.getByRole('link'))).toBe(true);
  });

  it('keeps the phone row gap at 40px and the desktop row gap at 48px', () => {
    expect(RESULTS_GRID_GAP_CLASS).toContain('gap-y-10 sm:gap-y-12');
  });
});
