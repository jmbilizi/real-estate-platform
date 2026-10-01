import { render, screen } from '@testing-library/react';
import NeighborhoodsView, { NeighborhoodsSkeleton } from './NeighborhoodsView';

const section = (truncated: boolean) => ({
  key: 'MD',
  heading: 'Maryland',
  truncated,
  neighborhoods: [{ name: 'Bethesda', city: 'Bethesda', state: 'MD', sale: 6, rent: 0 }],
});

describe('NeighborhoodsView', () => {
  it('renders a heading and a tile per neighborhood', () => {
    render(<NeighborhoodsView sections={[section(false)]} />);
    expect(screen.getByRole('heading', { name: 'Maryland' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Bethesda' })).toBeTruthy();
    expect(screen.queryByText(/most\s+listings/)).toBeNull();
  });

  it('notes the 100 cap for a truncated state', () => {
    render(<NeighborhoodsView sections={[section(true)]} />);
    expect(screen.getByText(/100 neighborhoods with the most\s+listings/)).toBeTruthy();
  });

  it('shows a factual empty state with a link to homes for sale', () => {
    render(<NeighborhoodsView sections={[]} />);
    expect(screen.getByText(/no neighborhoods to show/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /homes for sale/i }).getAttribute('href')).toBe(
      '/homes-for-sale',
    );
  });

  it('keeps each count on one line with 3-digit counts on both sides', () => {
    const sections = [
      {
        ...section(false),
        neighborhoods: [{ name: 'Canton', city: 'Baltimore', state: 'MD', sale: 109, rent: 141 }],
      },
    ];
    render(<NeighborhoodsView sections={sections} />);
    expect(screen.getByText('109 for sale').className).toContain('whitespace-nowrap');
    expect(screen.getByText('141 for rent').className).toContain('whitespace-nowrap');
  });

  it('renders no h1 in the skeleton, so the streamed page has one', () => {
    render(<NeighborhoodsSkeleton count={1} />);
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('renders skeleton tiles in the same grid', () => {
    const { container } = render(<NeighborhoodsSkeleton count={4} />);
    expect(container.querySelectorAll('div[aria-hidden="true"]')).toHaveLength(4);
  });
});
