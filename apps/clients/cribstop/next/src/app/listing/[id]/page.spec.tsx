/**
 * The redirect decision (#349): a hard load of `/listing/[id]` redirects to the property page's
 * canonical URL when one resolves, and keeps rendering here when it does not (the seller withheld
 * the address). This exercises only that decision — `next/navigation` and every data source are
 * mocked, so `permanentRedirect` throwing (as it really does, to unwind to the redirect response)
 * is what proves the redirect fired.
 */
import { permanentRedirect } from 'next/navigation';
import { loadListingState } from '@/lib/api/listings-server';
import { loadPropertyPage } from '@/lib/api/property-page';
import ListingPage from './page';

jest.mock('next/navigation', () => ({
  permanentRedirect: jest.fn(() => {
    throw new Error('NEXT_REDIRECT (mock)');
  }),
}));

jest.mock('@/lib/api/property-page', () => ({
  loadPropertyPage: jest.fn(),
}));

jest.mock('@/lib/api/listings-server', () => ({
  loadListingState: jest.fn(),
}));

jest.mock('@/components/listing/StandaloneListingView', () => ({
  __esModule: true,
  default: () => null,
}));

const mockedRedirect = permanentRedirect as unknown as jest.Mock;
const mockedLoadPropertyPage = loadPropertyPage as jest.Mock;
const mockedLoadListingState = loadListingState as jest.Mock;

describe('ListingPage — property-page redirect decision', () => {
  beforeEach(() => {
    mockedRedirect.mockClear();
    mockedLoadListingState.mockResolvedValue({ status: 'not-found' });
  });

  it('redirects to the canonical property page of the listing home (#382)', async () => {
    mockedLoadPropertyPage.mockResolvedValue({
      status: 'ready',
      page: { canonicalPath: '/property/118-baggett-place-alexandria-va/home-1' },
    });

    await expect(ListingPage({ params: Promise.resolve({ id: 'listing-1' }) })).rejects.toThrow();

    expect(mockedRedirect).toHaveBeenCalledWith('/property/118-baggett-place-alexandria-va/home-1');
  });

  it('redirects a withheld address to its city-only property page', async () => {
    mockedLoadPropertyPage.mockResolvedValue({
      status: 'ready',
      page: { canonicalPath: '/property/alexandria-va/home-2' },
    });

    await expect(ListingPage({ params: Promise.resolve({ id: 'listing-2' }) })).rejects.toThrow();

    expect(mockedRedirect).toHaveBeenCalledWith('/property/alexandria-va/home-2');
  });

  it('does not redirect when the property-page lookup 404s', async () => {
    mockedLoadPropertyPage.mockResolvedValue({ status: 'not-found' });

    await ListingPage({ params: Promise.resolve({ id: 'listing-3' }) });

    expect(mockedRedirect).not.toHaveBeenCalled();
  });

  it('does not redirect when the property-page lookup errors', async () => {
    mockedLoadPropertyPage.mockResolvedValue({ status: 'error', message: 'x' });

    await ListingPage({ params: Promise.resolve({ id: 'listing-4' }) });

    expect(mockedRedirect).not.toHaveBeenCalled();
  });
});
