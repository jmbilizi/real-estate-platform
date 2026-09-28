import { render, screen } from '@testing-library/react';
import NeighborhoodRow, { type Neighborhood } from './NeighborhoodRow';

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
    expect(screen.getByText('207 for sale · 93 for rent')).toBeInTheDocument();
  });

  it('omits the zero part of the counts, rather than showing "0 for rent"', () => {
    renderRow();

    expect(screen.getByText('40 for sale')).toBeInTheDocument();
    expect(screen.queryByText(/0 for rent/)).not.toBeInTheDocument();
  });

  it('links a tile to the neighborhood search path', () => {
    renderRow();

    const link = screen.getByText('Columbia Heights').closest('a');
    expect(link).toHaveAttribute(
      'href',
      '/washington-dc/columbia-heights-neighborhood/homes-for-sale',
    );
  });

  it('shows no photo — text tiles only', () => {
    const { container } = renderRow();
    expect(container.querySelector('img')).toBeNull();
  });

  it('caps visible tiles at max, all reachable by horizontal scroll rather than a "See all" tile', () => {
    const many: Neighborhood[] = Array.from({ length: 12 }, (_, i) => ({
      name: `Place ${i}`,
      city: 'Washington',
      state: 'DC',
      sale: 10,
      rent: 0,
    }));
    renderRow({ neighborhoods: many, max: 8 });

    expect(screen.getAllByRole('link').length).toBe(8);
    expect(screen.queryByText('See all')).not.toBeInTheDocument();
  });

  it('renders no "See all" header link when href is omitted', () => {
    renderRow();
    expect(screen.queryByLabelText('See all')).not.toBeInTheDocument();
  });

  it('keeps a passed "See all" header link and its arrow buttons at least 44px, never shrinking beside a long heading', () => {
    renderRow({ href: '/homes-for-sale', title: 'Explore neighborhoods across the region' });

    const seeAll = screen.getByLabelText('See all');
    expect(seeAll.className).toContain('flex-shrink-0');
    expect(seeAll.className).toContain('h-11');
    expect(seeAll.className).toContain('w-11');

    for (const label of ['Scroll left', 'Scroll right']) {
      const button = screen.getByLabelText(label);
      expect(button.className).toContain('flex-shrink-0');
      expect(button.className).toContain('h-11');
      expect(button.className).toContain('w-11');
    }
  });

  it('renders nothing when there are no neighborhoods and the fetch has settled', () => {
    const { container } = renderRow({ neighborhoods: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders skeleton tiles, not an empty row, while loading', () => {
    const { container } = renderRow({ neighborhoods: [], loading: true, max: 4 });
    expect(container.querySelectorAll('.skeleton-fill').length).toBeGreaterThan(0);
    expect(screen.getByText('Explore neighborhoods')).toBeInTheDocument();
  });
});
