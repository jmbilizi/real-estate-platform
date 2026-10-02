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

  it('renders the not-found page for a slug that matches nothing', async () => {
    (searchRouteProps as jest.Mock).mockResolvedValue({ status: 'not-found' });
    await expect(
      SearchPathView({ parsed: parsed as never, params: new URLSearchParams() }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });
});
