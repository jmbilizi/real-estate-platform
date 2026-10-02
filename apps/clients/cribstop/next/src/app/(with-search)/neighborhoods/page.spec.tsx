import { permanentRedirect } from 'next/navigation';
import NeighborhoodsRedirect from './page';

jest.mock('next/navigation', () => ({ permanentRedirect: jest.fn() }));

describe('/neighborhoods redirect (#504)', () => {
  beforeEach(() => jest.clearAllMocks());

  const go = (params: Record<string, string | string[] | undefined>) =>
    NeighborhoodsRedirect({ searchParams: Promise.resolve(params) });

  it('sends the bare page to the default grouped search', async () => {
    await go({});
    expect(permanentRedirect).toHaveBeenCalledWith('/homes-for-sale?type=all&groupBy=neighborhood');
  });

  it('keeps the state', async () => {
    await go({ state: 'MD' });
    expect(permanentRedirect).toHaveBeenCalledWith(
      '/homes-for-sale?state=MD&type=all&groupBy=neighborhood',
    );
  });

  it('keeps the state and city', async () => {
    await go({ state: 'MD', city: 'Rockville' });
    expect(permanentRedirect).toHaveBeenCalledWith(
      '/rockville-md/homes-for-sale?type=all&groupBy=neighborhood',
    );
  });

  it('drops a state that is not licensed, and its city', async () => {
    await go({ state: 'TX', city: 'Austin' });
    expect(permanentRedirect).toHaveBeenCalledWith('/homes-for-sale?type=all&groupBy=neighborhood');
  });
});
