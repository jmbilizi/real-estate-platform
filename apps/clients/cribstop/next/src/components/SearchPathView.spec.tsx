import { parseSearchPath } from '@cribstop/property-contracts';
import { notFound, permanentRedirect } from 'next/navigation';
import SearchPathView, { searchPathMetadata } from './SearchPathView';

jest.mock('next/navigation', () => ({
  notFound: jest.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  permanentRedirect: jest.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));
jest.mock('@/components/SearchExperience', () => ({ __esModule: true, default: () => null }));
jest.mock('@/lib/search-route', () => ({ searchRouteProps: jest.fn() }));

jest.mock('@/lib/api/listings-initial', () => ({ loadInitialResults: jest.fn() }));
jest.mock('@/lib/api/city-stats', () => ({ loadCityStats: jest.fn() }));

import { renderToStaticMarkup } from 'react-dom/server';
import { loadCityStats } from '@/lib/api/city-stats';
import { loadInitialResults } from '@/lib/api/listings-initial';
import { searchRouteProps } from '@/lib/search-route';

const found = {
  status: 'found',
  initialQuery: '',
  place: { label: 'Alexandria, VA', filters: {}, query: '', searchPlace: null },
};
const stats = {
  activeCount: 42,
  medianPrice: 525000,
  asOf: '2026-10-14T12:00:00.000Z',
  sources: ['brightMLS'],
};

const parsed = parseSearchPath(['alexandria-va', 'old-town-neighborhood', 'homes-for-sale']);

describe('SearchPathView (#533)', () => {
  afterEach(() => jest.clearAllMocks());

  it('answers 308 for an old drill-down link', async () => {
    (searchRouteProps as jest.Mock).mockResolvedValue({
      status: 'redirect',
      to: '/alexandria-va/old-town-neighborhood/homes-for-sale',
    });
    await expect(
      SearchPathView({ parsed: parsed as never, params: new URLSearchParams() }),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(permanentRedirect).toHaveBeenCalledWith(
      '/alexandria-va/old-town-neighborhood/homes-for-sale',
    );
  });

  it('renders one H1 and hands the server results to the grid (#841)', async () => {
    const results = { results: [], total: 0, page: 1, pageSize: 20, pageCount: 1 };
    (searchRouteProps as jest.Mock).mockResolvedValue({
      status: 'found',
      initialQuery: '',
      place: { label: 'Alexandria, VA', filters: {}, query: '', searchPlace: null },
    });
    (loadInitialResults as jest.Mock).mockResolvedValue(results);
    const view = await SearchPathView({ parsed: parsed as never, params: new URLSearchParams() });
    const html = renderToStaticMarkup(view);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('Homes for sale in Alexandria, VA');
    expect(loadInitialResults).toHaveBeenCalledWith('', expect.objectContaining({ filters: {} }));
    const grid = (view as { props: { children: { props: { initialResults: unknown } }[] } }).props
      .children[1];
    expect(grid.props.initialResults).toBe(results);
  });

  it('renders the dated summary, the update date and the attribution (#842)', async () => {
    (searchRouteProps as jest.Mock).mockResolvedValue(found);
    (loadInitialResults as jest.Mock).mockResolvedValue(undefined);
    (loadCityStats as jest.Mock).mockResolvedValue(stats);
    const html = renderToStaticMarkup(
      await SearchPathView({ parsed: parsed as never, params: new URLSearchParams() }),
    );
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('42 active listings');
    expect(html).toContain('$525,000');
    expect(html).toContain('Updated Oct 14, 2026');
    expect(html).toContain('Bright MLS');
    expect(html).toContain('Real Broker, LLC');
  });

  it('hides the H1 visually and places the summary after the results (#929)', async () => {
    (searchRouteProps as jest.Mock).mockResolvedValue(found);
    (loadInitialResults as jest.Mock).mockResolvedValue(undefined);
    (loadCityStats as jest.Mock).mockResolvedValue(stats);
    const view = await SearchPathView({ parsed: parsed as never, params: new URLSearchParams() });
    const html = renderToStaticMarkup(view);
    expect(html).toMatch(/<h1 class="sr-only">Homes for sale in Alexandria, VA<\/h1>/);
    const children = (view as { props: { children: unknown[] } }).props.children;
    expect(children).toHaveLength(3);
    const summary = renderToStaticMarkup(children[2] as never);
    expect(summary).toContain('42 active listings');
    expect(summary).toContain('Real Broker, LLC');
    expect(summary).toContain('Listing information provided by Bright MLS');
    expect(summary).toContain('Deemed reliable but not guaranteed');
  });

  it('keeps the H1 and drops the figures when the stats read fails (#842)', async () => {
    (searchRouteProps as jest.Mock).mockResolvedValue(found);
    (loadInitialResults as jest.Mock).mockResolvedValue(undefined);
    (loadCityStats as jest.Mock).mockResolvedValue(null);
    const html = renderToStaticMarkup(
      await SearchPathView({ parsed: parsed as never, params: new URLSearchParams() }),
    );
    expect(html).toContain('Homes for sale in Alexandria, VA');
    expect(html).not.toContain('Updated');
  });

  it('throws on a failed place lookup, so the answer is a 5xx and never a 404 (#841)', async () => {
    (searchRouteProps as jest.Mock).mockResolvedValue({ status: 'error' });
    await expect(
      SearchPathView({ parsed: parsed as never, params: new URLSearchParams() }),
    ).rejects.toThrow('Place lookup failed');
    expect(notFound).not.toHaveBeenCalled();
  });

  it('renders the not-found page for a slug that matches nothing', async () => {
    (searchRouteProps as jest.Mock).mockResolvedValue({ status: 'not-found' });
    await expect(
      SearchPathView({ parsed: parsed as never, params: new URLSearchParams() }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });
});

describe('searchPathMetadata (#842)', () => {
  const OLD = process.env.SITE_ORIGIN;
  beforeEach(() => {
    process.env.SITE_ORIGIN = 'https://cribstop.example';
    (searchRouteProps as jest.Mock).mockResolvedValue(found);
  });
  afterEach(() => {
    process.env.SITE_ORIGIN = OLD;
    jest.clearAllMocks();
  });
  const city = parseSearchPath(['alexandria-va', 'homes-for-sale']);

  it('sets the tags and indexes a full page', async () => {
    (loadCityStats as jest.Mock).mockResolvedValue(stats);
    const meta = await searchPathMetadata(city as never, new URLSearchParams('beds=3'));
    expect(meta.title).toBe('Homes for sale in Alexandria, VA · Real Broker, LLC');
    expect(meta.description).toContain('42 active listings');
    expect(meta.alternates?.canonical).toBe(
      'https://cribstop.example/alexandria-va/homes-for-sale',
    );
    expect(meta.openGraph?.title).toBe(meta.title);
    expect(meta.twitter?.title).toBe(meta.title);
    expect(meta.robots).toEqual({ index: true, follow: true });
  });

  it('answers noindex, follow below the threshold', async () => {
    (loadCityStats as jest.Mock).mockResolvedValue({ ...stats, activeCount: 9 });
    const meta = await searchPathMetadata(city as never, new URLSearchParams());
    expect(meta.robots).toEqual({ index: false, follow: true });
  });

  it('answers noindex when the figures cannot be read', async () => {
    (loadCityStats as jest.Mock).mockResolvedValue(null);
    const meta = await searchPathMetadata(city as never, new URLSearchParams());
    expect(meta.robots).toEqual({ index: false, follow: true });
  });

  it('keeps a not-found city out of the index', async () => {
    (searchRouteProps as jest.Mock).mockResolvedValue({ status: 'not-found' });
    const meta = await searchPathMetadata(city as never, new URLSearchParams());
    expect(meta.robots).toEqual({ index: false });
  });
});
