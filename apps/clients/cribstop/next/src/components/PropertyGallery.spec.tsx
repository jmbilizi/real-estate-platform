import { render, screen } from '@testing-library/react';
import PropertyGallery from './PropertyGallery';

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
