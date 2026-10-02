import { render, screen } from '@testing-library/react';
import NeighborhoodRow, {
  type Neighborhood,
  NeighborhoodTile,
  NeighborhoodTileSkeleton,
} from './NeighborhoodRow';

const NEIGHBORHOODS: Neighborhood[] = [
  { name: 'Columbia Heights', city: 'Washington', state: 'DC', sale: 207, rent: 93 },
  { name: 'Petworth', city: 'Washington', state: 'DC', sale: 40, rent: 0 },
];

function renderRow(props: Partial<React.ComponentProps<typeof NeighborhoodRow>> = {}) {
  return render(
    <NeighborhoodRow title="Explore neighborhoods" neighborhoods={NEIGHBORHOODS} {...props} />,
  );
}

describe('NeighborhoodRow (#393)', () => {
  it('renders name, place and both counts', () => {
    renderRow();

    expect(screen.getByText('Columbia Heights')).toBeInTheDocument();
    expect(screen.getAllByText('Washington, DC').length).toBeGreaterThan(0);
    expect(screen.getByText('207 for sale')).toBeInTheDocument();
    expect(screen.getByText('93 for rent')).toBeInTheDocument();
  });

  it('omits a zero count: no link and no text, rather than "0 for rent"', () => {
    renderRow();

    expect(screen.getByText('40 for sale')).toBeInTheDocument();
    expect(screen.queryByText(/0 for rent/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/for rent in Petworth/)).not.toBeInTheDocument();
  });

  it('links the tile main link to the all-types neighborhood search (#492)', () => {
    renderRow();

    const link = screen.getByRole('link', { name: 'Columbia Heights' });
    expect(link).toHaveAttribute(
      'href',
      '/washington-dc/columbia-heights-neighborhood/homes-for-sale?type=all',
    );
  });

  it('links each count to its own search, with the place in the accessible name', () => {
    renderRow();

    expect(screen.getByRole('link', { name: '207 for sale in Columbia Heights' })).toHaveAttribute(
      'href',
      '/washington-dc/columbia-heights-neighborhood/homes-for-sale',
    );
    expect(screen.getByRole('link', { name: '93 for rent in Columbia Heights' })).toHaveAttribute(
      'href',
      '/washington-dc/columbia-heights-neighborhood/homes-for-rent',
    );
  });

  it('puts sale before rent and gives each count a 44px hit area', () => {
    renderRow();

    const sale = screen.getByRole('link', { name: '207 for sale in Columbia Heights' });
    const rent = screen.getByRole('link', { name: '93 for rent in Columbia Heights' });
    expect(sale.compareDocumentPosition(rent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const l of [sale, rent]) {
      expect(l.className).toContain('min-h-11');
      expect(l.className).toContain('flex-1');
    }
  });

  it('renders a single non-zero count as a link', () => {
    renderRow();

    expect(screen.getAllByRole('link', { name: /in Petworth/ })).toHaveLength(1);
    expect(screen.getByRole('link', { name: '40 for sale in Petworth' })).toBeInTheDocument();
  });

  it('renders a rent-only tile with a rent link and no sale link', () => {
    renderRow({
      neighborhoods: [{ name: 'Shaw', city: 'Washington', state: 'DC', sale: 0, rent: 12 }],
    });
    expect(screen.getByRole('link', { name: '12 for rent in Shaw' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/for sale in Shaw/)).not.toBeInTheDocument();
  });

  it('never nests an anchor inside an anchor', () => {
    const { container } = renderRow();
    expect(container.querySelectorAll('a a')).toHaveLength(0);
    expect(screen.getAllByRole('link')).toHaveLength(5);
  });

  it('centres the tile content and truncates a long name', () => {
    renderRow();
    const heading = screen.getByRole('heading', { name: 'Columbia Heights' });
    expect(heading.className).toContain('truncate');
    expect(heading.parentElement!.className).toContain('text-center');
    expect(heading.parentElement!.className).toContain('items-center');
  });

  it('reserves a photo placeholder on a tile with no photo', () => {
    const { container } = renderRow();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getAllByTestId('neighborhood-photo-placeholder')).toHaveLength(2);
  });

  describe('trailing "See all" tile (#495)', () => {
    const photo = (id: string) => ({ url: `https://img.example/${id}.jpg`, listingId: id });
    const WITH_PHOTOS: Neighborhood[] = [
      { ...NEIGHBORHOODS[0], previewPhotos: [photo('a1'), photo('a2')] },
      { ...NEIGHBORHOODS[1], previewPhotos: [photo('b1')] },
    ];

    it('renders after the last tile, as one link to the chip href', () => {
      renderRow({
        href: '/homes-for-sale?state=DC&type=all&groupBy=neighborhood',
        neighborhoods: WITH_PHOTOS,
      });

      const tile = screen.getByTestId('neighborhood-see-all-tile');
      expect(tile.tagName).toBe('A');
      expect(tile).toHaveAttribute(
        'href',
        '/homes-for-sale?state=DC&type=all&groupBy=neighborhood',
      );
      expect(tile).toHaveTextContent('See all');
      expect(tile.className).toContain('min-h-11');
      expect(tile.className).toContain('items-center');
      expect(tile.className).toContain('text-center');
      const petworth = screen.getByRole('link', { name: 'Petworth' }).closest('div')!;
      expect(
        petworth.compareDocumentPosition(tile) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(tile.nextElementSibling).toBeNull();
    });

    it('uses the same width classes as a neighborhood tile', () => {
      renderRow({
        href: '/homes-for-sale?type=all&groupBy=neighborhood',
        neighborhoods: WITH_PHOTOS,
      });

      const tile = screen.getByTestId('neighborhood-see-all-tile');
      const other = screen.getByRole('link', { name: 'Petworth' }).closest('div')!;
      const widths = (el: Element) =>
        el.className.split(' ').filter((c) => /^(sm:|md:|lg:|xl:)?w-/.test(c));
      expect(widths(tile).length).toBeGreaterThan(0);
      expect(widths(tile)).toEqual(widths(other));
    });

    it('draws photos only from the previewPhotos of tiles in the row', () => {
      const { container } = renderRow({
        href: '/homes-for-sale?type=all&groupBy=neighborhood',
        neighborhoods: WITH_PHOTOS,
      });

      const tile = screen.getByTestId('neighborhood-see-all-tile');
      const urls = Array.from(tile.querySelectorAll('img')).map((i) => i.getAttribute('src'));
      const allowed = WITH_PHOTOS.flatMap((n) => n.previewPhotos!.map((p) => p.url));
      expect(urls.length).toBe(3);
      for (const u of urls) expect(allowed).toContain(u);
      // One photo per tile comes first.
      expect(urls.slice(0, 2)).toEqual([allowed[0], allowed[2]]);
      expect(container.querySelectorAll('a a')).toHaveLength(0);
    });

    it('is text only when no tile has a photo', () => {
      renderRow({ href: '/homes-for-sale?type=all&groupBy=neighborhood' });

      const tile = screen.getByTestId('neighborhood-see-all-tile');
      expect(tile.querySelector('img')).toBeNull();
      expect(tile).toHaveTextContent('See all');
    });

    it('does not render without href', () => {
      renderRow({ neighborhoods: WITH_PHOTOS });
      expect(screen.queryByTestId('neighborhood-see-all-tile')).not.toBeInTheDocument();
    });

    it('does not render when the row is hidden', () => {
      const { container } = renderRow({
        href: '/homes-for-sale?type=all&groupBy=neighborhood',
        neighborhoods: [],
      });
      expect(container).toBeEmptyDOMElement();
    });

    it('is replaced by one extra skeleton tile while loading', () => {
      const { container } = renderRow({
        href: '/homes-for-sale?type=all&groupBy=neighborhood',
        neighborhoods: [],
        loading: true,
        max: 4,
      });
      expect(screen.queryByTestId('neighborhood-see-all-tile')).not.toBeInTheDocument();
      expect(container.querySelectorAll('[aria-hidden="true"].flex-col')).toHaveLength(5);
    });
  });

  it('caps visible tiles at max with no "See all" tile when href is omitted', () => {
    const many: Neighborhood[] = Array.from({ length: 12 }, (_, i) => ({
      name: `Place ${i}`,
      city: 'Washington',
      state: 'DC',
      sale: 10,
      rent: 0,
    }));
    renderRow({ neighborhoods: many, max: 8 });

    expect(screen.getAllByRole('link', { name: /^Place \d+$/ }).length).toBe(8);
    expect(screen.queryByText('See all')).not.toBeInTheDocument();
  });

  it('renders no "See all" header link when href is omitted', () => {
    renderRow();
    expect(screen.queryByLabelText(/see all/i)).not.toBeInTheDocument();
  });

  it('names the row in its own accessible name, not just "See all" (#423)', () => {
    renderRow({ href: '/homes-for-sale', title: 'Explore neighborhoods' });
    expect(screen.getAllByLabelText('Explore neighborhoods — see all')[0]).toBeInTheDocument();
  });

  it('keeps the "See all" link and arrow buttons at a 44px tap target via a hit-area pseudo element, with a ~32px visual box that never shrinks beside a long heading (#423, #447)', () => {
    renderRow({ href: '/homes-for-sale', title: 'Explore neighborhoods across the region' });

    // The whole title + chip is one link (#423): its own box is only as tall as its content
    // (`min-h-8`, matching the chip), but a `before:` pseudo element extends the tap target to
    // 44px without adding layout height (#447) — a `min-h-11` box left dead space under the
    // title that blew out the gap to the carousel below.
    const seeAll = screen.getAllByLabelText(/see all/i)[0];
    expect(seeAll.className).toContain('min-h-8');
    expect(seeAll.className).toContain('before:-top-1.5');
    expect(seeAll.className).toContain('before:-bottom-1.5');
    const chip = seeAll.querySelector('svg')?.parentElement;
    expect(chip?.className).toContain('shrink-0');
    expect(chip?.className).toContain('h-8');
    expect(chip?.className).toContain('w-8');

    for (const label of ['Scroll left', 'Scroll right']) {
      const button = screen.getByLabelText(label);
      expect(button.className).toContain('flex-shrink-0');
      expect(button.className).toContain('h-8');
      expect(button.className).toContain('w-8');
      expect(button.className).toContain('before:-inset-1.5');
    }
  });

  it('renders nothing when there are no neighborhoods and the fetch has settled', () => {
    const { container } = renderRow({ neighborhoods: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders skeleton tiles, not an empty row, while loading', () => {
    const { container } = renderRow({ neighborhoods: [], loading: true, max: 4 });
    expect(container.querySelectorAll('.skeleton-fill').length).toBeGreaterThan(0);
    // Same photo area as a real tile, so the row height holds (#492).
    expect(container.querySelector('.aspect-\\[10\\/7\\]')).not.toBeNull();
    expect(screen.getByText('Explore neighborhoods')).toBeInTheDocument();
  });
});

/** #520: below `sm` a grid tile is one row. The carousel tile keeps the vertical layout. */
describe('compact grid tile below sm (#520)', () => {
  const tile = (el: HTMLElement) => el.closest('.group') as HTMLElement;

  it('lays the grid tile out as a row below sm and a column from sm', () => {
    render(<NeighborhoodTile n={NEIGHBORHOODS[0]} grid />);
    const cls = tile(screen.getByText('Columbia Heights')).className.split(' ');
    expect(cls).toEqual(expect.arrayContaining(['flex-row', 'sm:flex-col', 'text-left']));
    expect(cls).not.toContain('flex-col');
  });

  it('sizes the photo stack 112px wide below sm and restores the tile area from sm', () => {
    render(<NeighborhoodTile n={NEIGHBORHOODS[0]} grid />);
    const cls = screen.getByTestId('neighborhood-photo-placeholder').className.split(' ');
    expect(cls).toEqual(
      expect.arrayContaining(['w-28', 'h-24', 'sm:w-full', 'sm:aspect-[10/7]', 'sm:h-auto']),
    );
  });

  it('keeps every link at 44px or taller', () => {
    render(<NeighborhoodTile n={NEIGHBORHOODS[0]} grid />);
    for (const name of [/for sale in/, /for rent in/]) {
      expect(screen.getByLabelText(name).className).toContain('min-h-11');
    }
  });

  it('keeps the carousel tile vertical', () => {
    render(<NeighborhoodTile n={NEIGHBORHOODS[0]} />);
    const el = tile(screen.getByText('Columbia Heights'));
    expect(el.className).toContain('flex-col');
    expect(el.className).not.toContain('flex-row');
    expect(screen.getByTestId('neighborhood-photo-placeholder').className).toContain(
      'aspect-[10/7] w-full',
    );
  });

  it('gives the grid skeleton the compact shape', () => {
    const { container } = render(<NeighborhoodTileSkeleton grid />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('flex-row');
    expect(root.className).toContain('sm:flex-col');
    expect(container.querySelector('.w-28.h-24')).not.toBeNull();
  });
});
