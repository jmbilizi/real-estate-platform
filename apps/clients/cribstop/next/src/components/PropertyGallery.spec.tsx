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

describe('PropertyGallery 3D tour entry (#573)', () => {
  const media = [{ url: 'https://example.com/a.jpg', altText: 'Front elevation' }];

  it('shows nothing without a tour URL', () => {
    render(<PropertyGallery media={media} tourUrl={null} />);
    expect(screen.queryByText('3D tour')).not.toBeInTheDocument();
  });

  it('shows nothing for a URL that is not https', () => {
    render(<PropertyGallery media={media} tourUrl="http://my.matterport.com/show/?m=a" />);
    expect(screen.queryByText(/3D tour/)).not.toBeInTheDocument();
  });

  it('opens an allowlisted host in a full-screen iframe and closes on Escape', () => {
    render(<PropertyGallery media={media} tourUrl="https://my.matterport.com/show/?m=a" />);
    fireEvent.click(screen.getByRole('button', { name: '3D tour' }));
    const frame = document.querySelector('iframe') as HTMLIFrameElement;
    expect(frame).toHaveAttribute('src', 'https://my.matterport.com/show/?m=a');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('moves focus to Close, locks page scroll, and restores both on close', () => {
    render(<PropertyGallery media={media} tourUrl="https://my.matterport.com/show/?m=a" />);
    const pill = screen.getByRole('button', { name: '3D tour' });
    pill.focus();
    fireEvent.click(pill);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    expect(document.documentElement.style.overflow).toBe('hidden');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(document.documentElement.style.overflow).toBe('');
    expect(pill).toHaveFocus();
  });

  it('keeps Tab inside the dialog: Shift+Tab on Close goes to the frame, the end sentinel goes to Close', () => {
    render(<PropertyGallery media={media} tourUrl="https://my.matterport.com/show/?m=a" />);
    fireEvent.click(screen.getByRole('button', { name: '3D tour' }));
    const close = screen.getByRole('button', { name: 'Close' });
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.querySelector('iframe')).toHaveFocus();
    fireEvent.focus(screen.getByRole('dialog').lastElementChild as HTMLElement);
    expect(close).toHaveFocus();
  });

  it('opens any other https host in a new tab', () => {
    render(<PropertyGallery media={media} tourUrl="https://tours.example.com/t/1" />);
    const link = screen.getByRole('link', { name: /3D tour/ });
    expect(link).toHaveAttribute('href', 'https://tours.example.com/t/1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
