import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { fireEvent, render, screen } from '@testing-library/react';
import NeighborhoodCard, { NeighborhoodCardSkeleton } from './NeighborhoodCard';
import NeighborhoodGroupGrid from './NeighborhoodGroupGrid';
import NeighborhoodRow from './NeighborhoodRow';

const N = {
  name: 'Columbia Heights',
  city: 'Washington',
  state: 'DC',
  sale: 207,
  rent: 93,
  previewPhotos: [
    { url: 'https://img.test/a.jpg', listingId: 'a' },
    { url: 'https://img.test/b.jpg', listingId: 'b' },
  ],
};
const ROW = {
  key: 'dc|washington|columbia heights',
  name: N.name,
  city: N.city,
  state: N.state,
  slug: 'columbia-heights',
  total: 300,
  sale: N.sale,
  rent: N.rent,
  centroid: null,
  bounds: null,
  previewPhotos: N.previewPhotos,
};

/** The card in a given container: the same card must come out of every caller (#534). */
function cardHtml(container: HTMLElement) {
  return (container.querySelector('.group.relative') as HTMLElement).outerHTML;
}

describe('NeighborhoodCard (#534)', () => {
  it('renders the name, place, neutral counts and count links', () => {
    render(<NeighborhoodCard n={N} />);
    expect(screen.getByRole('link', { name: 'Columbia Heights' })).toBeInTheDocument();
    expect(screen.getByText('Washington, DC')).toBeInTheDocument();
    expect(screen.getByLabelText('207 for sale in Columbia Heights')).toHaveTextContent(
      '207 for sale',
    );
    expect(screen.getByLabelText('93 for rent in Columbia Heights')).toHaveTextContent(
      '93 for rent',
    );
  });

  it('renders no count for a zero count', () => {
    render(<NeighborhoodCard n={{ ...N, rent: 0 }} />);
    expect(screen.queryByText(/for rent/)).toBeNull();
  });

  it('shows decorative photos with empty alt text', () => {
    const { container } = render(<NeighborhoodCard n={N} />);
    const imgs = container.querySelectorAll('img');
    expect(imgs).toHaveLength(2);
    imgs.forEach((img) => expect(img.getAttribute('alt')).toBe(''));
  });

  it('uses the vertical layout and no horizontal variant', () => {
    const { container } = render(<NeighborhoodCard n={N} />);
    const cls = (container.firstElementChild as HTMLElement).className.split(' ');
    expect(cls).toEqual(expect.arrayContaining(['flex-col', 'text-center', 'w-full']));
    expect(cls).not.toContain('flex-row');
    expect(cls.some((c) => c.startsWith('sm:flex-'))).toBe(false);
  });

  it('keeps every link at 44px or taller', () => {
    render(<NeighborhoodCard n={N} />);
    for (const name of [/for sale in/, /for rent in/]) {
      expect(screen.getByLabelText(name).className).toContain('min-h-11');
    }
  });

  it('caps the photo stack so a full-width card does not stretch it', () => {
    render(<NeighborhoodCard n={{ ...N, previewPhotos: [] }} />);
    expect(screen.getByTestId('neighborhood-photo-placeholder').className).toContain('max-w-64');
  });

  it('uses hrefFor and runs onSelect on a plain click only', () => {
    const onSelect = jest.fn();
    render(
      <NeighborhoodCard
        n={N}
        hrefFor={(t) => `/x/${t ?? 'all'}`}
        onSelect={onSelect}
        sync={{ key: 'k', onActive: jest.fn() }}
      />,
    );
    const link = screen.getByLabelText(/for sale in/);
    expect(link).toHaveAttribute('href', '/x/sale');
    fireEvent.click(link, { metaKey: true });
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(link);
    expect(onSelect).toHaveBeenCalledWith('sale');
  });

  it('reports hover to the map link', () => {
    const onActive = jest.fn();
    const { container } = render(<NeighborhoodCard n={N} sync={{ key: 'k', onActive }} />);
    fireEvent.mouseEnter(container.firstElementChild!);
    expect(onActive).toHaveBeenCalledWith('k');
    // Hover alone never highlights the card (#540).
    expect(container.firstElementChild).not.toHaveAttribute('data-active');
    expect(container.firstElementChild).toHaveClass('border-surface-border');
  });

  it('has a skeleton with the same photo area and box', () => {
    const a = render(<NeighborhoodCard n={{ ...N, previewPhotos: [] }} />);
    const b = render(<NeighborhoodCardSkeleton />);
    const area = (c: HTMLElement) => c.querySelector('.aspect-\\[10\\/7\\]')!.className;
    expect(area(b.container)).toContain('max-w-64');
    expect(area(b.container)).toContain('aspect-[10/7]');
    expect(a.getByTestId('neighborhood-photo-placeholder').className).toContain('max-w-64');
    expect(b.container.querySelectorAll('.skeleton-fill').length).toBeGreaterThan(0);
  });

  it('renders the same card markup in the home row and the search grid', () => {
    const home = render(<NeighborhoodRow title="Explore" neighborhoods={[N]} />);
    const search = render(
      <NeighborhoodGroupGrid rows={[ROW] as never} hrefFor={() => '/x'} onSelect={jest.fn()} />,
    );
    const strip = (html: string) => html.replace(/href="[^"]*"/g, '');
    expect(strip(cardHtml(search.container))).toBe(strip(cardHtml(home.container)));
  });
});

/**
 * Guard (#534): the card file is the only place that renders neighborhood photo, count and link
 * markup. A change to the card then applies everywhere.
 */
describe('single neighborhood card guard (#534)', () => {
  const dir = __dirname;
  const read = (f: string) => readFileSync(join(dir, f), 'utf8');

  it('has NeighborhoodRow and NeighborhoodGroupGrid render NeighborhoodCard', () => {
    for (const f of ['NeighborhoodRow.tsx', 'NeighborhoodGroupGrid.tsx']) {
      const src = read(f);
      expect(src).toMatch(/from '@\/components\/NeighborhoodCard'/);
      expect(src).toMatch(/<NeighborhoodCard\b/);
      expect(src).toMatch(/<NeighborhoodCardSkeleton\b/);
    }
  });

  it('keeps count copy, photo-stack and card markup out of every other file', () => {
    // #722. The ZIP and broker group cards reuse the one photo stack and own no photo markup.
    const allowed = new Set([
      'NeighborhoodCard.tsx',
      'NeighborhoodPhotoStack.tsx',
      'ListingGroupGrid.tsx',
    ]);
    const offenders = readdirSync(dir)
      .filter((f) => /\.tsx?$/.test(f) && !/\.spec\./.test(f) && !allowed.has(f))
      .filter((f) => {
        const src = read(f);
        return (
          /NeighborhoodPhotoStack|neighborhood-photo|previewPhotos/.test(src) ||
          /\)\}\s*for (sale|rent)\b|\bfor (sale|rent) in \$\{/.test(src)
        );
      });
    expect(offenders).toEqual([]);
  });

  it('has no grid fork or compact variant in the card or the photo stack', () => {
    for (const f of ['NeighborhoodCard.tsx', 'NeighborhoodPhotoStack.tsx']) {
      const src = read(f);
      expect(src).not.toMatch(/\bgrid\??:\s*boolean|compact|COMPACT/);
    }
  });
});
