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

describe('NeighborhoodPhotoStack on NeighborhoodRow (#487)', () => {
  it('keeps the text tile with 0 photos', () => {
    const { container } = renderTile(0);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByTestId('neighborhood-photo-stack')).toBeNull();
    expect(screen.getByText('Petworth')).toBeInTheDocument();
  });

  it('keeps the text tile when the field is absent', () => {
    const n = { ...tile(0), previewPhotos: undefined };
    const { container } = render(<NeighborhoodRow title="t" neighborhoods={[n]} />);
    expect(container.querySelector('img')).toBeNull();
  });

  it.each([1, 2])('renders %i photo(s) in the smaller stack', (count) => {
    const { container } = renderTile(count);
    const imgs = container.querySelectorAll('img');
    expect(imgs).toHaveLength(count);
    expect(imgs[0]).toHaveAttribute('width', '56');
  });

  it('renders the first 3 photos in API order at the larger size', () => {
    const { container } = renderTile(3);
    expect(srcs(container)).toEqual(photos(3).map((p) => p.url));
    expect(container.querySelector('img')).toHaveAttribute('width', '64');
  });

  it('shows only 3 of 5 photos', () => {
    const { container } = renderTile(5);
    expect(srcs(container)).toEqual(photos(3).map((p) => p.url));
  });

  it('uses empty alt, lazy loading and adds no second link', () => {
    const { container } = renderTile(3);
    container.querySelectorAll('img').forEach((img) => {
      expect(img).toHaveAttribute('alt', '');
      expect(img).toHaveAttribute('loading', 'lazy');
    });
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      '/washington-dc/petworth-neighborhood/homes-for-sale',
    );
  });

  it('replaces a failed photo with the next unused one', () => {
    const { container } = renderTile(5);
    fireEvent.error(container.querySelectorAll('img')[1]);
    expect(srcs(container)).toEqual([0, 2, 3].map((i) => photos(5)[i].url));
  });

  it('drops to the smaller stack when no replacement remains', () => {
    const { container } = renderTile(3);
    fireEvent.error(container.querySelectorAll('img')[0]);
    expect(srcs(container)).toEqual([photos(3)[1].url, photos(3)[2].url]);
    expect(container.querySelector('img')).toHaveAttribute('width', '56');
  });

  it('falls back to the text tile when every photo fails', () => {
    const { container } = renderTile(1);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('Petworth')).toBeInTheDocument();
  });
});
