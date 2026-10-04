import { act, fireEvent, render, screen, within } from '@testing-library/react';
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

  it('plays an allowlisted host in the viewer and closes on Escape', () => {
    render(<PropertyGallery media={media} tourUrl="https://my.matterport.com/show/?m=a" />);
    fireEvent.click(screen.getByRole('button', { name: '3D tour' }));
    const frame = document.querySelector('iframe') as HTMLIFrameElement;
    expect(frame).toHaveAttribute('src', 'https://my.matterport.com/show/?m=a');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
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

  it('puts the frame between Close and Prev, so Tab leaves the frame for Prev', () => {
    render(<PropertyGallery media={media} tourUrl="https://my.matterport.com/show/?m=a" />);
    fireEvent.click(screen.getByRole('button', { name: '3D tour' }));
    const frame = document.querySelector('iframe') as HTMLIFrameElement;
    const follows = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(screen.getByRole('button', { name: 'Close' }), frame)).toBe(true);
    expect(follows(frame, screen.getByRole('button', { name: 'Previous' }))).toBe(true);
  });

  it('opens any other https host in a new tab, with an external-link icon', () => {
    render(<PropertyGallery media={media} tourUrl="https://tours.example.com/t/1" />);
    const link = screen.getByRole('link', { name: /3D tour/ });
    expect(link).toHaveAttribute('href', 'https://tours.example.com/t/1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link.querySelectorAll('svg')).toHaveLength(2);
    expect(screen.queryByTestId('gallery-swipe-tour')).toBeNull();
    expect(screen.getByTestId('gallery-swipe-counter')).toHaveTextContent('1 / 1');
  });

  it('keeps the page URL as the new-tab link and plays the embed form', () => {
    render(<PropertyGallery media={media} tourUrl="https://vimeo.com/76979871" />);
    fireEvent.click(screen.getByRole('button', { name: '3D tour' }));
    expect(document.querySelector('iframe')).toHaveAttribute(
      'src',
      'https://player.vimeo.com/video/76979871',
    );
    expect(screen.getByRole('link', { name: /Open the tour in a new tab/ })).toHaveAttribute(
      'href',
      'https://vimeo.com/76979871',
    );
  });
});

describe('PropertyGallery tour slide (#590)', () => {
  const photos = [
    { url: 'https://example.com/a.jpg', altText: 'A', caption: 'Kitchen' },
    { url: 'https://example.com/b.jpg', altText: 'B', caption: 'Den' },
    { url: 'https://example.com/c.jpg', altText: 'C' },
  ];
  const tourUrl = 'https://my.matterport.com/show/?m=abc';
  const counter = () => screen.getByTestId('gallery-swipe-counter');
  const scrollStripTo = (slide: number) => {
    const track = screen.getByTestId('gallery-swipe');
    Object.defineProperty(track, 'clientWidth', { value: 300, configurable: true });
    track.scrollLeft = slide * 300;
    fireEvent.scroll(track);
  };
  const setViewport = (desktop: boolean) => {
    window.matchMedia = jest.fn().mockReturnValue({ matches: desktop }) as never;
  };
  const settle = () => act(() => void jest.advanceTimersByTime(300));
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  it('puts the tour right after the cover photo and keeps photo labels', () => {
    render(<PropertyGallery media={photos} tourUrl={tourUrl} />);
    const strip = screen.getByTestId('gallery-swipe');
    expect(strip.children).toHaveLength(4);
    expect(strip.children[1]).toBe(screen.getByTestId('gallery-swipe-tour'));
    expect(strip.children[2]).toHaveAttribute('aria-label', 'View photo 2 of 3');
    expect(strip.children[3]).toHaveAttribute('aria-label', 'View photo 3 of 3');
    expect(counter()).toHaveTextContent('1 / 4');
  });

  it('adds no slide when the tour cannot be framed', () => {
    render(<PropertyGallery media={photos} tourUrl="https://tours.example.com/t/1" />);
    expect(screen.getByTestId('gallery-swipe').children).toHaveLength(3);
    expect(counter()).toHaveTextContent('1 / 3');
  });

  it('opens a photo tile on that photo, not on the slide with the same number', () => {
    render(<PropertyGallery media={photos} tourUrl={tourUrl} />);
    fireEvent.click(screen.getByTestId('gallery-swipe').children[2]);
    expect(screen.getByRole('dialog')).toHaveTextContent('3 / 4');
    expect(screen.getByTestId('gallery-caption')).toHaveTextContent('Den');
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('steps from the cover to the tour and on to the second photo', () => {
    render(<PropertyGallery media={photos} tourUrl={tourUrl} />);
    fireEvent.click(screen.getByRole('button', { name: 'View primary photo' }));
    expect(document.querySelector('iframe')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('2 / 4');
    expect(document.querySelector('iframe')).toHaveAttribute('src', tourUrl);
    expect(screen.getByTestId('gallery-caption')).toHaveTextContent('');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.getByTestId('gallery-caption')).toHaveTextContent('Den');
  });

  it('loads the iframe only while the tour slide is active', () => {
    render(<PropertyGallery media={photos} tourUrl={tourUrl} />);
    expect(document.querySelector('iframe')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'View primary photo' }));
    expect(document.querySelector('iframe')).toBeNull();
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(document.querySelector('iframe')).not.toBeNull();
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('opens the viewer on the tour slide when the pill is used on a desktop', () => {
    setViewport(true);
    render(<PropertyGallery media={photos} tourUrl={tourUrl} />);
    fireEvent.click(screen.getByRole('button', { name: '3D tour' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('2 / 4');
    expect(document.querySelector('iframe')).toHaveAttribute('src', tourUrl);
  });

  it('jumps the swipe strip to the tour slide when the pill is used on a phone', () => {
    setViewport(false);
    render(<PropertyGallery media={photos} tourUrl={tourUrl} />);
    scrollStripTo(0);
    fireEvent.click(screen.getByRole('button', { name: '3D tour' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    scrollStripTo(1);
    settle();
    expect(counter()).toHaveTextContent('2 / 4');
    expect(document.querySelector('iframe')).toHaveAttribute('src', tourUrl);
  });

  it('loads the strip frame only in view and ignores touches until the visitor taps', () => {
    render(<PropertyGallery media={photos} tourUrl={tourUrl} />);
    expect(document.querySelector('iframe')).toBeNull();
    scrollStripTo(1);
    expect(document.querySelector('iframe')).toBeNull();
    settle();
    const frame = document.querySelector('iframe') as HTMLIFrameElement;
    expect(frame.className).toMatch(/pointer-events-none/);
    fireEvent.click(screen.getByRole('button', { name: 'Tap to explore the 3D tour' }));
    expect(frame.className).not.toMatch(/pointer-events-none/);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(frame.className).toMatch(/pointer-events-none/);
    fireEvent.click(screen.getByRole('button', { name: 'Tap to explore the 3D tour' }));
    scrollStripTo(2);
    expect(document.querySelector('iframe')).toBeNull();
    scrollStripTo(1);
    settle();
    expect(document.querySelector('iframe')?.className).toMatch(/pointer-events-none/);
  });

  it('does not load the strip frame for a swipe that only passes the tour slide', () => {
    render(<PropertyGallery media={photos} tourUrl={tourUrl} />);
    scrollStripTo(1);
    act(() => void jest.advanceTimersByTime(100));
    scrollStripTo(2);
    settle();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('shows the tour alone when the listing has no photo', () => {
    setViewport(true);
    render(<PropertyGallery media={[]} tourUrl={tourUrl} />);
    fireEvent.click(screen.getByRole('button', { name: '3D tour' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('1 / 1');
    expect(document.querySelector('iframe')).toHaveAttribute('src', tourUrl);
  });
});

describe('PropertyGallery phone pass (#572)', () => {
  const photos = [
    { url: 'https://example.com/a.jpg', altText: 'A' },
    { url: 'https://example.com/b.jpg', altText: 'B' },
    { url: 'https://example.com/c.jpg', altText: 'C' },
  ];
  const open = () =>
    fireEvent.click(screen.getAllByRole('button', { name: 'View photo 2 of 3' })[0]);

  it('moves focus into the photo viewer, locks page scroll, and restores both on close', () => {
    render(<PropertyGallery media={photos} />);
    const tile = screen.getAllByRole('button', { name: 'View photo 2 of 3' })[0];
    tile.focus();
    fireEvent.click(tile);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    expect(document.documentElement.style.overflow).toBe('hidden');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(document.documentElement.style.overflow).toBe('');
    expect(tile).toHaveFocus();
  });

  it('keeps Tab inside the photo viewer', () => {
    render(<PropertyGallery media={photos} />);
    open();
    const close = screen.getByRole('button', { name: 'Close' });
    const next = screen.getByRole('button', { name: 'Next' });
    next.focus();
    fireEvent.keyDown(next, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(next).toHaveFocus();
  });

  it('pulls focus back in when it sits outside the viewer', () => {
    render(<PropertyGallery media={photos} />);
    open();
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('keeps Escape from reaching the modal behind it', () => {
    const outer = jest.fn();
    window.addEventListener('keydown', outer);
    render(<PropertyGallery media={photos} />);
    open();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    expect(outer).not.toHaveBeenCalled();
    window.removeEventListener('keydown', outer);
  });

  it('gives the viewer controls and the tour pill a 44px target on a phone', () => {
    render(<PropertyGallery media={photos} tourUrl="https://my.matterport.com/show/?m=a" />);
    expect(screen.getByRole('button', { name: '3D tour' }).className).toMatch(/\bmin-h-11\b/);
    open();
    for (const name of ['Close', 'Previous', 'Next']) {
      expect(screen.getByRole('button', { name }).className).toMatch(/\bmin-h-11\b/);
    }
  });

  it('clears the notch and the home indicator in the viewer', () => {
    render(<PropertyGallery media={photos} />);
    open();
    const html = screen.getByRole('dialog').innerHTML;
    expect(html).toContain('env(safe-area-inset-top)');
    expect(html).toContain('env(safe-area-inset-bottom)');
  });

  it('resets the swipe counter when the photo set changes', () => {
    const { rerender } = render(<PropertyGallery media={photos} />);
    const track = screen.getByTestId('gallery-swipe');
    Object.defineProperty(track, 'clientWidth', { value: 300, configurable: true });
    track.scrollLeft = 600;
    fireEvent.scroll(track);
    expect(screen.getByTestId('gallery-swipe-counter')).toHaveTextContent('3 / 3');

    rerender(
      <PropertyGallery
        media={[
          { url: 'https://example.com/x.jpg', altText: 'X' },
          { url: 'https://example.com/y.jpg', altText: 'Y' },
        ]}
      />,
    );
    expect(screen.getByTestId('gallery-swipe-counter')).toHaveTextContent('1 / 2');
    expect(track.scrollLeft).toBe(0);
  });

  it('keeps the counter when a parent rebuilds an identical array', () => {
    const { rerender } = render(<PropertyGallery media={photos} />);
    const track = screen.getByTestId('gallery-swipe');
    Object.defineProperty(track, 'clientWidth', { value: 300, configurable: true });
    track.scrollLeft = 300;
    fireEvent.scroll(track);
    rerender(<PropertyGallery media={photos.map((p) => ({ ...p }))} />);
    expect(screen.getByTestId('gallery-swipe-counter')).toHaveTextContent('2 / 3');
  });
});
