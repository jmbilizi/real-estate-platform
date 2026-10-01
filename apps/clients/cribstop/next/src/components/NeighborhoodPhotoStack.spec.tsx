import { fireEvent, render, screen } from '@testing-library/react';
import NeighborhoodRow, { type Neighborhood } from './NeighborhoodRow';

const photos = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ url: `https://img.test/p${i}.jpg`, listingId: `L${i}` }));

const tile = (count: number): Neighborhood => ({
  name: 'Petworth',
  city: 'Washington',
  state: 'DC',
  sale: 40,
  rent: 2,
  previewPhotos: photos(count),
});

function renderTile(count: number) {
  return render(<NeighborhoodRow title="Explore neighborhoods" neighborhoods={[tile(count)]} />);
}

const srcs = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('img')).map((i) => i.getAttribute('src'));

describe('NeighborhoodPhotoStack on NeighborhoodRow (#487, #492)', () => {
  it('reserves a placeholder of the same size with 0 photos', () => {
    const { container } = renderTile(0);
    const placeholder = screen.getByTestId('neighborhood-photo-placeholder');
    expect(container.querySelector('img')).toBeNull();
    expect(placeholder).toHaveAttribute('aria-hidden', 'true');
    expect(placeholder.textContent).toBe('');
    expect(placeholder.className).toContain('aspect-[10/7]');
    expect(screen.getByText('Petworth')).toBeInTheDocument();
  });

  it('reserves the placeholder when the field is absent', () => {
    const n = { ...tile(0), previewPhotos: undefined };
    const { container } = render(<NeighborhoodRow title="t" neighborhoods={[n]} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('neighborhood-photo-placeholder')).toBeInTheDocument();
  });

  it.each([1, 2, 3])('renders %i photo(s) with the same photo-area class', (count) => {
    const { container } = renderTile(count);
    expect(container.querySelectorAll('img')).toHaveLength(count);
    expect(screen.getByTestId('neighborhood-photo-stack').className).toContain('aspect-[10/7]');
  });

  it('sizes photos as a percent of the stack width, not in pixels', () => {
    const { container } = renderTile(3);
    const frame = container.querySelector('img')!.parentElement!;
    expect(frame.style.width).toBe('50%');
  });

  it('renders the first 3 photos in API order', () => {
    const { container } = renderTile(3);
    expect(srcs(container)).toEqual(photos(3).map((p) => p.url));
  });

  it('shows only 3 of 5 photos', () => {
    const { container } = renderTile(5);
    expect(srcs(container)).toEqual(photos(3).map((p) => p.url));
  });

  it('uses empty alt and lazy loading', () => {
    const { container } = renderTile(3);
    container.querySelectorAll('img').forEach((img) => {
      expect(img).toHaveAttribute('alt', '');
      expect(img).toHaveAttribute('loading', 'lazy');
    });
  });

  it('replaces a failed photo with the next unused one', () => {
    const { container } = renderTile(5);
    fireEvent.error(container.querySelectorAll('img')[1]);
    expect(srcs(container)).toEqual([0, 2, 3].map((i) => photos(5)[i].url));
  });

  it('drops to a 2-photo stack when no replacement remains', () => {
    const { container } = renderTile(3);
    fireEvent.error(container.querySelectorAll('img')[0]);
    expect(srcs(container)).toEqual([photos(3)[1].url, photos(3)[2].url]);
    expect(container.querySelector('img')!.parentElement!.style.width).toBe('52%');
  });

  it('falls back to the placeholder when every photo fails', () => {
    const { container } = renderTile(1);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('neighborhood-photo-placeholder')).toBeInTheDocument();
  });
});
