import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import ListingStickyBar from './ListingStickyBar';

type IoCallback = (entries: Partial<IntersectionObserverEntry>[]) => void;
interface FakeObserver {
  callback: IoCallback;
  options: IntersectionObserverInit | undefined;
  targets: Element[];
}

let observers: FakeObserver[] = [];

beforeEach(() => {
  observers = [];
  global.IntersectionObserver = jest.fn((callback: IoCallback, options) => {
    const o: FakeObserver = { callback, options, targets: [] };
    observers.push(o);
    return {
      observe: (el: Element) => o.targets.push(el),
      disconnect: jest.fn(),
      unobserve: jest.fn(),
      takeRecords: jest.fn(),
    };
  }) as unknown as typeof IntersectionObserver;
  window.matchMedia = jest.fn().mockReturnValue({ matches: false }) as never;
});

function Harness({ sections, skip }: { sections: string[]; skip?: string[] }) {
  const root = useRef<HTMLDivElement>(null);
  const gallery = useRef<HTMLDivElement>(null);
  return (
    <div ref={root}>
      <ListingStickyBar
        galleryRef={gallery}
        scopeRef={root}
        price="$500,000"
        address="12 Elm St"
        skip={skip}
        actions={<button>Message</button>}
      />
      <div ref={gallery}>gallery</div>
      {sections.map((id) => (
        <section key={id} id={id}>
          {id}
        </section>
      ))}
    </div>
  );
}

/** The gallery observer is the first one created. */
function setGalleryOutOfView(out: boolean) {
  act(() =>
    observers[0].callback([
      {
        isIntersecting: !out,
        boundingClientRect: { top: out ? -300 : 20 } as DOMRectReadOnly,
        rootBounds: { top: 65 } as DOMRectReadOnly,
      },
    ]),
  );
}

describe('ListingStickyBar', () => {
  it('renders nothing while the gallery is in view', () => {
    render(<Harness sections={['overview']} />);
    expect(screen.queryByTestId('listing-sticky-bar')).toBeNull();
  });

  it('shows price, address and the actions once the gallery has scrolled out', () => {
    render(<Harness sections={['overview']} />);
    setGalleryOutOfView(true);
    const bar = screen.getByTestId('listing-sticky-bar');
    expect(within(bar).getByText('$500,000')).toBeInTheDocument();
    expect(within(bar).getByText('12 Elm St')).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Message' })).toBeInTheDocument();
  });

  it('hides again when the gallery returns', () => {
    render(<Harness sections={['overview']} />);
    setGalleryOutOfView(true);
    setGalleryOutOfView(false);
    expect(screen.queryByTestId('listing-sticky-bar')).toBeNull();
  });

  it('is display:none below md, so a phone never shows it', () => {
    render(<Harness sections={['overview']} />);
    expect(screen.getByTestId('listing-sticky-bar-anchor').className).toMatch(
      /\bhidden\b.*\bmd:block\b/,
    );
  });

  it('links only the sections that exist', () => {
    render(<Harness sections={['overview', 'map']} />);
    setGalleryOutOfView(true);
    const nav = screen.getByRole('navigation', { name: 'Listing sections' });
    expect(
      within(nav)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Overview', 'Map']);
  });

  it('omits a section named in `skip`', () => {
    render(<Harness sections={['overview', 'nearby']} skip={['nearby']} />);
    setGalleryOutOfView(true);
    expect(screen.queryByRole('button', { name: 'Nearby' })).toBeNull();
  });

  it('scrolls the window to the section with the bar offset', async () => {
    window.scrollBy = jest.fn();
    render(<Harness sections={['overview', 'map']} />);
    setGalleryOutOfView(true);
    await userEvent.click(screen.getByRole('button', { name: 'Map' }));
    expect(window.scrollBy).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'smooth', top: expect.any(Number) }),
    );
  });

  it('jumps without animation under prefers-reduced-motion', async () => {
    window.scrollBy = jest.fn();
    (window.matchMedia as jest.Mock).mockReturnValue({ matches: true });
    render(<Harness sections={['overview', 'map']} />);
    setGalleryOutOfView(true);
    await userEvent.click(screen.getByRole('button', { name: 'Map' }));
    expect(window.scrollBy).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
  });

  it('marks the section in view as current', () => {
    render(<Harness sections={['overview', 'facts', 'map']} />);
    setGalleryOutOfView(true);
    const spy = observers[observers.length - 1];
    act(() =>
      spy.callback([{ isIntersecting: true, target: document.getElementById('facts') as Element }]),
    );
    expect(screen.getByRole('button', { name: 'Facts' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Map' })).not.toHaveAttribute('aria-current');
  });
});
