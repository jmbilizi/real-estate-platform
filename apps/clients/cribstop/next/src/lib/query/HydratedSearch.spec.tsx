import { renderToString } from 'react-dom/server';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { makeTestQueryClient } from '@/test/renderWithClient';
import type { ListingsEnvelope } from '@cribstop/property-contracts';
import { searchListings } from '@/lib/api/listings';
import HydratedSearch from './HydratedSearch';
import { requestKey, searchResultsOptions } from './search';

jest.mock('@/lib/api/listings', () => ({
  ...jest.requireActual('@/lib/api/listings'),
  searchListings: jest.fn(),
}));

const REQUEST = { city: 'Bethesda', state: 'MD', page: 1, pageSize: 20 } as const;
const RESULTS = { results: [], total: 42, page: 1, pageSize: 20, pageCount: 3 } as never;

function Total() {
  const { data } = useQuery(searchResultsOptions({ ...REQUEST }));
  return <p>{data ? `total ${(data as ListingsEnvelope).total}` : 'loading'}</p>;
}

describe('HydratedSearch (#910, #900)', () => {
  it('puts the server page in the first HTML and makes no request', () => {
    const html = renderToString(
      <QueryClientProvider client={makeTestQueryClient()}>
        <HydratedSearch request={{ ...REQUEST }} results={RESULTS}>
          <Total />
        </HydratedSearch>
      </QueryClientProvider>,
    );
    expect(html).toContain('total 42');
    expect(searchListings).not.toHaveBeenCalled();
  });

  it('gives equal requests one key whatever the property order', () => {
    expect(requestKey({ state: 'MD', city: 'Bethesda' })).toBe(
      requestKey({ city: 'Bethesda', state: 'MD', beds: undefined, q: '' }),
    );
  });
});
