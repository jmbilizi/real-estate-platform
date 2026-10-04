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

  it('wears the site theme and shows the caller actions in the top bar (#599)', () => {
    render(<PropertyGallery media={photos} viewerActions={<button type="button">Save</button>} />);
    openLightbox();
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toMatch(/\bbg-white\b/);
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Close' }).className).toMatch(
      /focus-visible:ring-brand/,
    );
    expect(within(dialog).getByRole('button', { name: 'Next' }).className).toMatch(
      /rounded-full.*shadow-card/,
    );
    expect(within(dialog).getByTestId('gallery-caption').className).toMatch(/text-ink-muted/);
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
    expect(screen.queryByRole('button', { name: 'Open 3D tour' })).not.toBeInTheDocument();
  });

  it('shows "3D" and keeps the bottom left clear for the Bright MLS watermark (#599)', () => {
    const { container } = render(
      <PropertyGallery media={media} tourUrl="https://my.matterport.com/show/?m=a" />,
    );
    const pill = screen.getByTestId('gallery-tour-pill');
    expect(pill).toHaveTextContent(/^3D$/);
    expect(pill).toHaveAttribute('aria-label', 'Open 3D tour');
    const row = pill.parentElement as HTMLElement;
    expect(row.className).toMatch(/\bbottom-3\b/);
    expect(row.className).toMatch(/\bright-3\b/);
    const counter = screen.getByTestId('gallery-swipe-counter');
    expect(row).toContainElement(counter);
    expect(pill.compareDocumentPosition(counter) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(counter.className).toMatch(/pointer-events-none/);
    expect(row.className).toMatch(/pointer-events-none/);
    expect(container.querySelector('[class*="left-"]')).toBeNull();
  });

  it('puts the tour tile in the first small mosaic tile, with the label and a photo behind', () => {
    const photos = [
      { url: 'https://example.com/a.jpg', altText: 'A' },
      { url: 'https://example.com/b.jpg', altText: 'B' },
      { url: 'https://example.com/c.jpg', altText: 'C' },
    ];
    render(<PropertyGallery media={photos} tourUrl="https://my.matterport.com/show/?m=a" />);
    const tile = screen.getByTestId('gallery-tour-tile');
    expect(tile).toHaveAttribute('aria-label', 'Open 3D tour');
    expect(tile).toHaveTextContent('Explore 3D tour');
    expect(within(tile).getByAltText('B')).toBeInTheDocument();
    const grid = tile.parentElement as HTMLElement;
    expect(grid.children[0]).toHaveAttribute('aria-label', 'View primary photo');
    expect(grid.children[1]).toBe(tile);
    expect(grid.children).toHaveLength(1 + 1 + 3 + 1);
    expect(within(grid).getByRole('button', { name: /Show all 3 photos/ })).toBeInTheDocument();
    fireEvent.click(tile);
    expect(screen.getByRole('dialog')).toHaveTextContent('2 / 4');
    expect(document.querySelector('iframe')).toHaveAttribute(
      'src',
      'https://my.matterport.com/show/?m=a',
    );
  });

  it('keeps the mosaic as before when there is no tour', () => {
    const photos = [
      { url: 'https://example.com/a.jpg', altText: 'A' },
      { url: 'https://example.com/b.jpg', altText: 'B' },
    ];
    render(<PropertyGallery media={photos} />);
    expect(screen.queryByTestId('gallery-tour-tile')).toBeNull();
    expect(screen.queryByTestId('gallery-tour-pill')).toBeNull();
    expect(
      screen.getByRole('button', { name: /Show all 2 photos/ }).parentElement?.children,
    ).toHaveLength(6);
  });

  it('shows nothing for a URL that is not https', () => {
    render(<PropertyGallery media={media} tourUrl="http://my.matterport.com/show/?m=a" />);
    expect(screen.queryByRole('link', { name: /3D tour/ })).not.toBeInTheDocument();
  });

  it('plays an allowlisted host in the viewer and closes on Escape', () => {
    render(<PropertyGallery media={media} tourUrl="https://my.matterport.com/show/?m=a" />);
    fireEvent.click(screen.getByTestId('gallery-tour-pill'));
    const frame = document.querySelector('iframe') as HTMLIFrameElement;
    expect(frame).toHaveAttribute('src', 'https://my.matterport.com/show/?m=a');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('moves focus to Close, locks page scroll, and restores both on close', () => {
    render(<PropertyGallery media={media} tourUrl="https://my.matterport.com/show/?m=a" />);
    const pill = screen.getByTestId('gallery-tour-pill');
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
    fireEvent.click(screen.getByTestId('gallery-tour-pill'));
    const frame = document.querySelector('iframe') as HTMLIFrameElement;
    const follows = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(screen.getByRole('button', { name: 'Close' }), frame)).toBe(true);
    expect(follows(frame, screen.getByRole('button', { name: 'Previous' }))).toBe(true);
  });

  it('opens any other https host in a new tab, with an external-link icon', () => {
    render(<PropertyGallery media={media} tourUrl="https://tours.example.com/t/1" />);
    const link = screen.getByTestId('gallery-tour-pill');
    expect(link).toHaveAttribute('href', 'https://tours.example.com/t/1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link.querySelectorAll('svg')).toHaveLength(2);
    expect(link).toHaveAttribute('aria-label', 'Open 3D tour in a new tab');
    const tile = screen.getByTestId('gallery-tour-tile');
    expect(tile).toHaveAttribute('href', 'https://tours.example.com/t/1');
    expect(tile).toHaveAttribute('target', '_blank');
    expect(tile).toHaveTextContent('Explore 3D tour');
    expect(tile.querySelectorAll('svg')).toHaveLength(2);
    expect(screen.queryByTestId('gallery-swipe-tour')).toBeNull();
    expect(screen.getByTestId('gallery-swipe-counter')).toHaveTextContent('1 / 1');
  });

  it('keeps the page URL as the new-tab link and plays the embed form', () => {
    render(<PropertyGallery media={media} tourUrl="https://vimeo.com/76979871" />);
    fireEvent.click(screen.getByTestId('gallery-tour-pill'));
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
    fireEvent.click(screen.getByTestId('gallery-tour-pill'));
    expect(screen.getByRole('dialog')).toHaveTextContent('2 / 4');
    expect(document.querySelector('iframe')).toHaveAttribute('src', tourUrl);
  });

  it('jumps the swipe strip to the tour slide when the pill is used on a phone', () => {
    setViewport(false);
    render(<PropertyGallery media={photos} tourUrl={tourUrl} />);
    scrollStripTo(0);
    fireEvent.click(screen.getByTestId('gallery-tour-pill'));
    expect(screen.queryByRole('dialog')).toBeNull();
    scrollStripTo(1);
    expect(counter()).toHaveTextContent('2 / 4');
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.queryByTestId('gallery-tour-pill')).toBeNull();
  });

  it('shows the tour tile in the strip and loads the frame only after a tap', () => {
    render(<PropertyGallery media={photos} tourUrl={tourUrl} />);
    scrollStripTo(1);
    const slide = screen.getByTestId('gallery-swipe-tour');
    expect(slide).toHaveTextContent('Explore 3D tour');
    expect(within(slide).getByAltText('B')).toBeInTheDocument();
    expect(document.querySelector('iframe')).toBeNull();
    fireEvent.click(within(slide).getByRole('button', { name: 'Explore 3D tour' }));
    expect(document.querySelector('iframe')).toHaveAttribute('src', tourUrl);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(document.querySelector('iframe')).toBeNull();
    expect(slide).toHaveTextContent('Explore 3D tour');
    fireEvent.click(within(slide).getByRole('button', { name: 'Explore 3D tour' }));
    scrollStripTo(2);
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('does not load the strip frame for a swipe that only passes the tour slide', () => {
    render(<PropertyGallery media={photos} tourUrl={tourUrl} />);
    scrollStripTo(1);
    scrollStripTo(2);
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('shows the tour alone when the listing has no photo', () => {
    setViewport(true);
    render(<PropertyGallery media={[]} tourUrl={tourUrl} />);
    fireEvent.click(screen.getByTestId('gallery-tour-pill'));
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
  const tile = () => screen.getAllByRole('button', { name: 'View photo 2 of 3' })[0];
  const open = () => fireEvent.click(tile());

  it('moves focus into the photo viewer, locks page scroll, and restores both on close', () => {
    render(<PropertyGallery media={photos} />);
    const opener = tile();
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    expect(document.documentElement.style.overflow).toBe('hidden');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(document.documentElement.style.overflow).toBe('');
    expect(opener).toHaveFocus();
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
    expect(screen.getByTestId('gallery-tour-pill').className).toMatch(/\bmin-h-11\b/);
    open();
    for (const name of ['Close', 'Previous', 'Next']) {
      expect(screen.getByRole('button', { name }).className).toMatch(/\b(min-h-11|h-11)\b/);
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
