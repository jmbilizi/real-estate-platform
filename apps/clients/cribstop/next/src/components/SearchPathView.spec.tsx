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
jest.mock('@/components/SearchExperience', () => ({
  __esModule: true,
  default: ({ aboutSlot }: { aboutSlot?: unknown }) => aboutSlot ?? null,
}));
jest.mock('@/lib/search-route', () => ({ searchRouteProps: jest.fn() }));

jest.mock('@/lib/api/listings-initial', () => ({
  loadInitialResults: jest.fn(),
  initialRequestFor: jest.fn(() => ({ page: 1 })),
}));
jest.mock('@/lib/api/city-stats', () => ({ loadCityStats: jest.fn(), loadCityMedians: jest.fn() }));
jest.mock('@/lib/api/zip-groups', () => ({ loadCityZips: jest.fn() }));
jest.mock('@/lib/api/neighborhood-groups', () => ({ loadCityNeighborhoods: jest.fn() }));

import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClientProvider } from '@tanstack/react-query';
import { makeTestQueryClient } from '@/test/renderWithClient';
import { loadCityMedians, loadCityStats } from '@/lib/api/city-stats';
import { loadCityZips } from '@/lib/api/zip-groups';
import { loadCityNeighborhoods } from '@/lib/api/neighborhood-groups';
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
    const html = renderToStaticMarkup(
      <QueryClientProvider client={makeTestQueryClient()}>{view}</QueryClientProvider>,
    );
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('Homes for sale in Alexandria, VA');
    expect(loadInitialResults).toHaveBeenCalledWith('', expect.objectContaining({ filters: {} }));
    const grid = (view as { props: { children: { props: { results: unknown } }[] } }).props
      .children[1];
    expect(grid.props.results).toBe(results);
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

  it('hides the H1 visually and keeps the summary out of the page flow (#947)', async () => {
    (searchRouteProps as jest.Mock).mockResolvedValue(found);
    (loadInitialResults as jest.Mock).mockResolvedValue(undefined);
    (loadCityStats as jest.Mock).mockResolvedValue(stats);
    const view = await SearchPathView({ parsed: parsed as never, params: new URLSearchParams() });
    const html = renderToStaticMarkup(view);
    expect(html).toMatch(/<h1 class="sr-only">Homes for sale in Alexandria, VA<\/h1>/);
    expect((view as { props: { children: unknown[] } }).props.children).toHaveLength(2);
    expect(html).not.toContain('<section');
  });

  it('puts the summary and the attribution in the server HTML, behind the info button (#947)', async () => {
    (searchRouteProps as jest.Mock).mockResolvedValue(found);
    (loadInitialResults as jest.Mock).mockResolvedValue(undefined);
    (loadCityStats as jest.Mock).mockResolvedValue(stats);
    const html = renderToStaticMarkup(
      await SearchPathView({ parsed: parsed as never, params: new URLSearchParams() }),
    );
    expect(html).toMatch(/<button[^>]*aria-label="About these listings"/);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('class="sr-only"');
    expect(html).toContain('42 active listings');
    expect(html).toContain('Source: Bright MLS.');
    expect(html).toContain('Real Broker, LLC');
    expect(html).toContain('Listing information provided by Bright MLS');
    expect(html).toContain('Deemed reliable but not guaranteed');
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
    const meta = await searchPathMetadata(city as never, new URLSearchParams());
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

  it.each(['beds=3', 'boundary=abc', 'bounds=1,2,3,4', 'page=1', 'beds=3&page=2'])(
    'answers noindex, follow with the clean canonical for ?%s (#847)',
    async (qs) => {
      (loadCityStats as jest.Mock).mockResolvedValue(stats);
      const meta = await searchPathMetadata(city as never, new URLSearchParams(qs));
      expect(meta.robots).toEqual({ index: false, follow: true });
      expect(meta.alternates?.canonical).toBe(
        'https://cribstop.example/alexandria-va/homes-for-sale',
      );
    },
  );

  it('answers noindex, follow with a self canonical for page 2 and up (#847)', async () => {
    (loadCityStats as jest.Mock).mockResolvedValue(stats);
    const meta = await searchPathMetadata(city as never, new URLSearchParams('page=3'));
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(meta.alternates?.canonical).toBe(
      'https://cribstop.example/alexandria-va/homes-for-sale?page=3',
    );
  });

  it('applies the same rules to the map-area path (#847)', async () => {
    const area = { place: null, segment: 'homes-for-sale' };
    const clean = await searchPathMetadata(area as never, new URLSearchParams());
    expect(clean.robots).toBeUndefined();
    expect(clean.alternates?.canonical).toBe('https://cribstop.example/homes-for-sale');
    for (const qs of ['boundary=abc', 'bounds=1,2,3,4']) {
      const meta = await searchPathMetadata(area as never, new URLSearchParams(qs));
      expect(meta.robots).toEqual({ index: false, follow: true });
      expect(meta.alternates?.canonical).toBe('https://cribstop.example/homes-for-sale');
    }
    const paged = await searchPathMetadata(area as never, new URLSearchParams('page=2'));
    expect(paged.robots).toEqual({ index: false, follow: true });
    expect(paged.alternates?.canonical).toBe('https://cribstop.example/homes-for-sale?page=2');
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

describe('a bare ZIP page (#973)', () => {
  const OLD = process.env.SITE_ORIGIN;
  const zipPath = parseSearchPath(['22304', 'homes-for-sale']);
  const zipFound = {
    status: 'found',
    initialQuery: '',
    place: {
      label: 'Alexandria, VA 22304',
      filters: { zip: '22304' },
      query: '',
      searchPlace: { kind: 'zip-only', zip: '22304' },
    },
    area: { city: 'Alexandria', state: 'VA' },
  };
  beforeEach(() => {
    process.env.SITE_ORIGIN = 'https://cribstop.example';
    (searchRouteProps as jest.Mock).mockResolvedValue(zipFound);
    (loadInitialResults as jest.Mock).mockResolvedValue(undefined);
    (loadCityStats as jest.Mock).mockResolvedValue(stats);
    (loadCityZips as jest.Mock).mockResolvedValue([
      { key: '22304', count: 40 },
      { key: '22302', count: 25 },
      { key: '22301', count: 25 },
      { key: '22305', count: 4 },
    ]);
  });
  afterEach(() => {
    process.env.SITE_ORIGIN = OLD;
    jest.clearAllMocks();
  });

  const render = async () =>
    renderToStaticMarkup(
      await SearchPathView({ parsed: zipPath as never, params: new URLSearchParams() }),
    );

  it('renders one H1 and the dated summary', async () => {
    const html = await render();
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('Homes for sale in Alexandria, VA 22304');
    expect(html).toContain('42 active listings');
    expect(html).toContain('Updated Oct 14, 2026');
  });

  it('renders Home, City, ZIP breadcrumbs in the server HTML with BreadcrumbList JSON-LD', async () => {
    const html = await render();
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toMatch(/<a[^>]*href="\/"[^>]*>Home<\/a>/);
    expect(html).toMatch(/<a[^>]*href="\/alexandria-va\/homes-for-sale"[^>]*>Alexandria, VA<\/a>/);
    expect(html).toMatch(/<span[^>]*aria-current="page"[^>]*>22304<\/span>/);
    expect(html).toContain('"@type":"BreadcrumbList"');
  });

  it('drops the City level when the ZIP maps to no single city, and lists no nearby ZIP', async () => {
    const { area: _area, ...noArea } = zipFound;
    (searchRouteProps as jest.Mock).mockResolvedValue(noArea);
    const html = await render();
    expect(html).not.toContain('href="/alexandria-va/homes-for-sale"');
    expect(html).not.toContain('Nearby ZIP codes');
    expect(loadCityZips).not.toHaveBeenCalled();
  });

  it('lists nearby ZIPs of the city at or above the threshold, by count then ZIP', async () => {
    const html = await render();
    expect(html).toContain('Homes for sale in nearby ZIP codes');
    const links = [...html.matchAll(/href="\/(\d{5})\/homes-for-sale"/g)].map((m) => m[1]);
    // The current ZIP and the ZIP below the threshold are absent.
    expect(links).toEqual(['22301', '22302']);
    expect(loadCityZips).toHaveBeenCalledWith('Alexandria', 'VA', 'sale');
  });

  it('keeps the page when the nearby read fails', async () => {
    (loadCityZips as jest.Mock).mockResolvedValue(null);
    const html = await render();
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).not.toContain('Nearby ZIP codes');
  });

  it('sets the canonical to the bare ZIP path and indexes a full page', async () => {
    const meta = await searchPathMetadata(zipPath as never, new URLSearchParams());
    expect(meta.title).toBe('Homes for sale in Alexandria, VA 22304 · Real Broker, LLC');
    expect(meta.alternates?.canonical).toBe('https://cribstop.example/22304/homes-for-sale');
    expect(meta.openGraph?.title).toBe(meta.title);
    expect(meta.twitter?.title).toBe(meta.title);
    expect(meta.robots).toEqual({ index: true, follow: true });
  });

  it('answers noindex, follow below the threshold', async () => {
    (loadCityStats as jest.Mock).mockResolvedValue({ ...stats, activeCount: 9 });
    const meta = await searchPathMetadata(zipPath as never, new URLSearchParams());
    expect(meta.robots).toEqual({ index: false, follow: true });
  });

  it('answers noindex for a ZIP that resolves to nothing', async () => {
    (searchRouteProps as jest.Mock).mockResolvedValue({ status: 'not-found' });
    const meta = await searchPathMetadata(zipPath as never, new URLSearchParams());
    expect(meta.robots).toEqual({ index: false });
  });
});

describe('the city medians table (#986)', () => {
  const cityPath = parseSearchPath(['alexandria-va', 'homes-for-sale']);
  const cityFound = {
    status: 'found',
    initialQuery: '',
    place: {
      label: 'Alexandria, VA',
      filters: { city: 'Alexandria', state: 'VA' },
      query: '',
      searchPlace: { kind: 'city', city: 'Alexandria', state: 'VA' },
    },
  };
  const stat = (value: number | null) => ({ value, inputCount: value === null ? 2 : 30 });
  const medians = {
    listingCount: 42,
    medianListPrice: stat(525000),
    medianDaysOnMarket: stat(18),
    medianPricePerSqft: stat(312),
    dataUpdatedAt: '2026-10-14T12:00:00.000Z',
  };
  beforeEach(() => {
    (searchRouteProps as jest.Mock).mockResolvedValue(cityFound);
    (loadInitialResults as jest.Mock).mockResolvedValue(undefined);
    (loadCityStats as jest.Mock).mockResolvedValue(stats);
    (loadCityMedians as jest.Mock).mockResolvedValue(medians);
  });
  afterEach(() => jest.clearAllMocks());

  const render = async () =>
    renderToStaticMarkup(
      await SearchPathView({ parsed: cityPath as never, params: new URLSearchParams() }),
    );

  it('renders the count and each median in the server HTML, each with date and source', async () => {
    const html = await render();
    expect(html).toContain('<table');
    expect(html).toContain('Median list price');
    expect(html).toContain('$525,000');
    expect(html).toContain('Median days on market');
    expect(html).toContain('Median price per sq ft');
    expect(html).toContain('$312');
    expect(html.match(/Oct 14, 2026<\/time> · Bright MLS/g)).toHaveLength(4);
    expect(loadCityMedians).toHaveBeenCalledWith('Alexandria', 'VA', 'sale');
  });

  it('shows "Not enough data" and no number for a null figure', async () => {
    (loadCityMedians as jest.Mock).mockResolvedValue({
      ...medians,
      medianDaysOnMarket: stat(null),
    });
    const html = await render();
    expect(html).toContain('Not enough data');
    expect(html).not.toContain('>18<');
  });

  it('hides the table, and keeps the page, when the stats call fails', async () => {
    (loadCityMedians as jest.Mock).mockResolvedValue(null);
    const html = await render();
    expect(html).not.toContain('<table');
    expect(html).not.toMatch(/fail|error/i);
    expect(html).toContain('42 active listings');
  });

  it('reads no medians for a ZIP page', async () => {
    (searchRouteProps as jest.Mock).mockResolvedValue({
      ...cityFound,
      place: {
        ...cityFound.place,
        searchPlace: { kind: 'zip-only', zip: '22304' },
        filters: { zip: '22304' },
      },
    });
    const html = await render();
    expect(html).not.toContain('<table');
    expect(loadCityMedians).not.toHaveBeenCalled();
  });
});

describe('a neighborhood page (#974)', () => {
  const OLD = process.env.SITE_ORIGIN;
  const path = parseSearchPath(['alexandria-va', 'del-ray-neighborhood', 'homes-for-sale']);
  const hoodFound = {
    status: 'found',
    initialQuery: '',
    place: {
      label: 'Del Ray, Alexandria, VA',
      filters: { neighborhood: 'Del Ray', city: 'Alexandria', state: 'VA' },
      query: '',
      searchPlace: { kind: 'neighborhood', name: 'Del Ray', city: 'Alexandria', state: 'VA' },
    },
    area: { city: 'Alexandria', state: 'VA' },
  };
  const hood = (name: string, total: number) => ({
    key: `va|alexandria|${name.toLowerCase()}`,
    name,
    city: 'Alexandria',
    state: 'VA',
    total,
  });
  beforeEach(() => {
    process.env.SITE_ORIGIN = 'https://cribstop.example';
    (searchRouteProps as jest.Mock).mockResolvedValue(hoodFound);
    (loadInitialResults as jest.Mock).mockResolvedValue(undefined);
    (loadCityStats as jest.Mock).mockResolvedValue(stats);
    (loadCityNeighborhoods as jest.Mock).mockResolvedValue([
      hood('Del Ray', 40),
      hood('Rosemont', 25),
      hood('Old Town', 25),
      hood('Seminary Hill', 4),
    ]);
  });
  afterEach(() => {
    process.env.SITE_ORIGIN = OLD;
    jest.clearAllMocks();
  });

  const render = async () =>
    renderToStaticMarkup(
      await SearchPathView({ parsed: path as never, params: new URLSearchParams() }),
    );

  it('renders Home, City, Neighborhood breadcrumbs with BreadcrumbList JSON-LD', async () => {
    const html = await render();
    expect(html).toMatch(/<a[^>]*href="\/"[^>]*>Home<\/a>/);
    expect(html).toMatch(/<a[^>]*href="\/alexandria-va\/homes-for-sale"[^>]*>Alexandria, VA<\/a>/);
    expect(html).toMatch(/<span[^>]*aria-current="page"[^>]*>Del Ray<\/span>/);
    expect(html).toContain('"@type":"BreadcrumbList"');
  });

  it('lists other neighborhoods at or above the threshold, by count then name', async () => {
    const html = await render();
    expect(html).toContain('Homes for sale in other neighborhoods of Alexandria');
    const links = [
      ...html.matchAll(/href="\/alexandria-va\/([a-z-]+)-neighborhood\/homes-for-sale"/g),
    ].map((m) => m[1]);
    // The current neighborhood and the one below the threshold are absent.
    expect(links).toEqual(['old-town', 'rosemont']);
    expect(loadCityNeighborhoods).toHaveBeenCalledWith('Alexandria', 'VA', 'sale');
  });

  it('keeps the page when the neighborhood read fails', async () => {
    (loadCityNeighborhoods as jest.Mock).mockResolvedValue(null);
    const html = await render();
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).not.toContain('Other neighborhoods');
  });

  it('answers noindex, follow below the threshold, canonical on the neighborhood path', async () => {
    (loadCityStats as jest.Mock).mockResolvedValue({ ...stats, activeCount: 9 });
    const meta = await searchPathMetadata(path as never, new URLSearchParams());
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(meta.alternates?.canonical).toBe(
      'https://cribstop.example/alexandria-va/del-ray-neighborhood/homes-for-sale',
    );
  });

  it('answers noindex for a neighborhood that resolves to nothing', async () => {
    (searchRouteProps as jest.Mock).mockResolvedValue({ status: 'not-found' });
    const meta = await searchPathMetadata(path as never, new URLSearchParams());
    expect(meta.robots).toEqual({ index: false });
  });
});
