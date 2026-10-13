import { parseSearchPath } from '@cribstop/property-contracts';
import { notFound, permanentRedirect } from 'next/navigation';
import SearchPathView from './SearchPathView';

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

import { renderToStaticMarkup } from 'react-dom/server';
import { loadInitialResults } from '@/lib/api/listings-initial';
import { searchRouteProps } from '@/lib/search-route';

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
