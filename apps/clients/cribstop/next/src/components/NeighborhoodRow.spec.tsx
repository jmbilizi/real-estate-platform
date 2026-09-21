import { fireEvent, render, screen } from '@testing-library/react';
import NeighborhoodRow from './NeighborhoodRow';

const NEIGHBORHOODS = [
  { name: 'Penn Quarter', city: 'Washington, DC', img: 'https://example.test/penn.jpg' },
  { name: 'Federal Hill', city: 'Baltimore, MD', img: 'https://example.test/fed.jpg' },
];

function renderRow(props: Partial<React.ComponentProps<typeof NeighborhoodRow>> = {}) {
  return render(
    <NeighborhoodRow title="Explore neighborhoods" neighborhoods={NEIGHBORHOODS} {...props} />,
  );
}

/**
 * The tiles are not data-loading — the list is a constant — so the window this covers is the remote
 * photo fetch. The tile is a special case among the app's loading states because its caption sits
 * *on* the photo rather than under it, which is what both of these describe.
 */
describe('NeighborhoodRow photo placeholders', () => {
  it('paints a placeholder over every tile until its photo lands', () => {
    const { container } = renderRow();

    expect(container.querySelectorAll('.skeleton-fill')).toHaveLength(NEIGHBORHOODS.length);
  });

  /** Same token as the listing carousels above and below, so the page sweeps as one surface. */
  it('uses the shared skeleton token rather than a local loading look', () => {
    const { container } = renderRow();

    expect(container.querySelector('.bg-surface-soft.skeleton-fill')).not.toBeNull();
  });

  /*
   * The regression this guards is the "half-alive card" failure `ListingCardSkeleton` documents.
   * Skeletoning only the image area left the real caption and its `from-black/80` gradient drawn on
   * top of the placeholder: half-real and half-grey, with the gradient crushing the tint to nothing
   * in the lower half so it did not even read as the same sweep as the cards beside it.
   */
  it('holds back the caption and its gradient, not just the photo', () => {
    const { container } = renderRow();

    expect(screen.queryByText('Penn Quarter')).toBeNull();
    expect(screen.queryByText('Washington, DC')).toBeNull();
    expect(screen.queryByText('Browse homes')).toBeNull();
    expect(container.querySelector('.bg-gradient-to-t')).toBeNull();
  });

  it('fades the whole tile in once the photo arrives', () => {
    const { container } = renderRow();
    // alt="" (WCAG H67 — the `<h3>` already names the tile), so the tile is found by DOM
    // order rather than by accessible name.
    const img = container.querySelectorAll('img')[0];

    expect(img).toHaveClass('opacity-0');

    fireEvent.load(img);

    expect(img).toHaveClass('content-resolved');
    expect(screen.getByText('Penn Quarter')).toBeInTheDocument();
    expect(container.querySelectorAll('.skeleton-fill')).toHaveLength(NEIGHBORHOODS.length - 1);
  });

  /** A dead URL must settle too — otherwise that one tile sweeps for the life of the page. */
  it('stops the sweep when the photo fails to load', () => {
    const { container } = renderRow();

    fireEvent.error(container.querySelectorAll('img')[0]);

    expect(container.querySelectorAll('.skeleton-fill')).toHaveLength(NEIGHBORHOODS.length - 1);
  });

  /** A tile with nothing drawn on it yet names no destination, so it is not a tab stop. */
  it('keeps the placeholder tile out of the tab order until it resolves', () => {
    const { container } = renderRow();
    const img = container.querySelectorAll('img')[0];
    const link = img.closest('a')!;

    expect(link).toHaveAttribute('tabindex', '-1');
    expect(link).toHaveAttribute('aria-hidden', 'true');

    fireEvent.load(img);

    expect(link).not.toHaveAttribute('tabindex');
    expect(link).not.toHaveAttribute('aria-hidden');
  });

  /** The "See all" tile's stacked thumbnails are photos on the same page and get the same cover. */
  it('covers the stacked thumbnails on the See all tile', () => {
    const { container } = renderRow({ href: '/search', max: 1 });

    // One visible tile plus the three thumbnails stacked inside the "See all" card.
    expect(container.querySelectorAll('.skeleton-fill').length).toBeGreaterThan(1);
  });
});
