import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import ListingHeaderNav from './ListingHeaderNav';

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
  const header = useRef<HTMLDivElement>(null);
  return (
    <div ref={root}>
      <div ref={header}>
        <ListingHeaderNav
          headerRef={header}
          scopeRef={root}
          price="$500,000"
          address="12 Elm St"
          skip={skip}
        />
      </div>
      {sections.map((id) => (
        <section key={id} id={id}>
          {id}
        </section>
      ))}
    </div>
  );
}

const spy = () => observers[observers.length - 1];
const spyEntries = (...ids: string[]) =>
  ids.map((id) => ({ isIntersecting: true, target: document.getElementById(id) as Element }));

describe('ListingHeaderNav', () => {
  it('shows the price and the address at once, with no scroll needed', () => {
    render(<Harness sections={['overview']} />);
    const nav = screen.getByTestId('listing-header-nav');
    expect(within(nav).getByText('$500,000')).toBeInTheDocument();
    expect(within(nav).getByText('12 Elm St')).toBeInTheDocument();
  });

  it('has no Message or Tour button', () => {
    render(<Harness sections={['overview']} />);
    expect(screen.queryByRole('button', { name: /message|tour/i })).toBeNull();
  });

  it('is display:none below md, so a phone never shows it', () => {
    render(<Harness sections={['overview']} />);
    expect(screen.getByTestId('listing-header-nav').className).toMatch(/\bhidden\b.*\bmd:flex\b/);
  });

  it('links only the sections that exist', () => {
    render(<Harness sections={['overview', 'map']} />);
    const nav = screen.getByRole('navigation', { name: 'Listing sections' });
    expect(
      within(nav)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Overview', 'Map']);
  });

  it('omits a section named in `skip`', () => {
    render(<Harness sections={['overview', 'nearby']} skip={['nearby']} />);
    expect(screen.queryByRole('button', { name: 'Nearby' })).toBeNull();
  });

  it('renders no nav when no section exists', () => {
    render(<Harness sections={[]} />);
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('scrolls the window to the section with the header offset', async () => {
    window.scrollBy = jest.fn();
    render(<Harness sections={['overview', 'map']} />);
    await userEvent.click(screen.getByRole('button', { name: 'Map' }));
    expect(window.scrollBy).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'smooth', top: expect.any(Number) }),
    );
  });

  it('jumps without animation under prefers-reduced-motion', async () => {
    window.scrollBy = jest.fn();
    (window.matchMedia as jest.Mock).mockReturnValue({ matches: true });
    render(<Harness sections={['overview', 'map']} />);
    await userEvent.click(screen.getByRole('button', { name: 'Map' }));
    expect(window.scrollBy).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
  });

  it('marks the section in view as current', () => {
    render(<Harness sections={['overview', 'facts', 'map']} />);
    act(() => spy().callback(spyEntries('facts')));
    expect(screen.getByRole('button', { name: 'Facts' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Map' })).not.toHaveAttribute('aria-current');
  });
});

describe('ListingHeaderNav clicked link (#572)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('is active at once and keeps the clicked link while the scroll passes other sections', () => {
    window.scrollBy = jest.fn();
    render(<Harness sections={['overview', 'facts', 'map']} />);
    act(() => spy().callback(spyEntries('overview')));

    fireEvent.click(screen.getByRole('button', { name: 'Map' }));
    expect(screen.getByRole('button', { name: 'Map' })).toHaveAttribute('aria-current', 'true');

    act(() => spy().callback(spyEntries('facts')));
    expect(screen.getByRole('button', { name: 'Map' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Facts' })).not.toHaveAttribute('aria-current');
  });

  it('hands control back to the scroll-spy once the scroll has settled', () => {
    window.scrollBy = jest.fn();
    render(<Harness sections={['overview', 'facts', 'map']} />);

    fireEvent.click(screen.getByRole('button', { name: 'Map' }));
    fireEvent.scroll(window);
    act(() => {
      jest.advanceTimersByTime(400);
    });
    act(() => spy().callback(spyEntries('facts')));
    expect(screen.getByRole('button', { name: 'Facts' })).toHaveAttribute('aria-current', 'true');
  });
});
