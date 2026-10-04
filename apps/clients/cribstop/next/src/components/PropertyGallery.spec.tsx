import { fireEvent, render, screen, within } from '@testing-library/react';
import PropertyGallery from './PropertyGallery';

describe('PropertyGallery badge slot (#565)', () => {
  const media = [{ url: 'https://example.com/a.jpg', altText: 'Front elevation' }];

  it('renders the badge over the photos', () => {
    render(
      <PropertyGallery media={media}>
        <span>For sale</span>
      </PropertyGallery>,
    );
    expect(screen.getByText('For sale')).toBeInTheDocument();
  });

  it('renders the badge over the placeholder when there are no photos', () => {
    render(
      <PropertyGallery media={[]}>
        <span>For sale</span>
      </PropertyGallery>,
    );
    expect(screen.getByText('For sale')).toBeInTheDocument();
  });
});

describe('PropertyGallery', () => {
  it('renders the branded placeholder rather than nothing when media is empty', () => {
    render(<PropertyGallery media={[]} />);

    expect(screen.getByText(/no photo available/i)).toBeInTheDocument();
  });

  it("uses each photo's own altText as the accessible name, never the listing title", () => {
    render(
      <PropertyGallery
        media={[
          { url: 'https://example.com/a.jpg', altText: 'Front elevation at dusk' },
          { url: 'https://example.com/b.jpg', altText: 'Kitchen with island' },
        ]}
      />,
    );

    expect(screen.getAllByAltText('Front elevation at dusk').length).toBeGreaterThan(0);
    expect(screen.getAllByAltText('Kitchen with island').length).toBeGreaterThan(0);
  });
});

describe('PropertyGallery lightbox', () => {
  const photos = [
    { url: 'https://example.com/a.jpg', altText: 'A', caption: 'Front porch' },
    { url: 'https://example.com/b.jpg', altText: 'B' },
    { url: 'https://example.com/c.jpg', altText: 'C' },
  ];
  const openLightbox = () =>
    fireEvent.click(screen.getByRole('button', { name: 'View primary photo' }));

  it('shows the counter once and moves with the arrow keys', () => {
    render(<PropertyGallery media={photos} />);
    openLightbox();

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByText('1 / 3')).toHaveLength(1);
    expect(within(dialog).getByTestId('gallery-caption')).toHaveTextContent('Front porch');

    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(within(dialog).getByText('2 / 3')).toBeInTheDocument();
    expect(within(dialog).getByTestId('gallery-caption')).toBeEmptyDOMElement();

    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(within(dialog).getByText('3 / 3')).toBeInTheDocument();
  });

  it('closes on Escape', () => {
    render(<PropertyGallery media={photos} />);
    openLightbox();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the mobile swipe strip with an n / N counter', () => {
    render(<PropertyGallery media={photos} />);
    expect(screen.getByTestId('gallery-swipe-counter')).toHaveTextContent('1 / 3');
  });
});
