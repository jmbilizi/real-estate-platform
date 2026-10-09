import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { aListingCardRow } from '@/test/fixtures';
import MapPinCard from './MapPinCard';
import { getListingCard, ListingsApiError } from '@/lib/api/listings';
import { getListingPanel, resetListingPanel } from '@/lib/listing-panel';
import { resetListingCardCache } from '@/lib/listing-card-cache';

const mockToggleSave = jest.fn();
jest.mock('@/lib/context', () => ({
  useApp: () => ({ toggleSave: mockToggleSave, isSaved: () => false }),
}));
jest.mock('@/lib/useToast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('@/lib/api/listings', () => {
  const actual = jest.requireActual('@/lib/api/listings');
  return { ...actual, getListingCard: jest.fn() };
});

const getCard = getListingCard as jest.Mock;
const ADDRESS = '100 Test St, Bethesda, MD 20814';

beforeEach(() => {
  getCard.mockReset();
  mockToggleSave.mockReset();
  resetListingCardCache();
  resetListingPanel();
});

describe('MapPinCard (#549)', () => {
  it('shows a loading state, then the shared card, for a pin off the results page', async () => {
    let resolve: (row: ReturnType<typeof aListingCardRow>) => void = () => undefined;
    getCard.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<MapPinCard id="off-page" />);

    expect(screen.getByRole('status', { name: /loading home/i })).toBeInTheDocument();
    expect(getCard).toHaveBeenCalledWith('off-page');

    await act(async () => resolve(aListingCardRow({ id: 'off-page' })));
    expect(screen.getByText(ADDRESS)).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not fetch for a row the results page already holds', () => {
    render(<MapPinCard id="on-page" row={aListingCardRow({ id: 'on-page' })} />);

    expect(screen.getByText(ADDRESS)).toBeInTheDocument();
    expect(getCard).not.toHaveBeenCalled();
  });

  it('keeps a fetched card, so the second click does not fetch again', async () => {
    getCard.mockResolvedValue(aListingCardRow({ id: 'off-page' }));
    const first = render(<MapPinCard id="off-page" />);
    await screen.findByText(ADDRESS);
    first.unmount();

    render(<MapPinCard id="off-page" />);

    // The card is there on the first paint, with no loading state.
    expect(screen.getByText(ADDRESS)).toBeInTheDocument();
    expect(getCard).toHaveBeenCalledTimes(1);
  });

  it('shows an error with a retry, and a retry fetches again', async () => {
    getCard.mockRejectedValueOnce(
      new ListingsApiError(
        'The listings service is temporarily unavailable.',
        'upstream_unavailable',
        503,
      ),
    );
    getCard.mockResolvedValueOnce(aListingCardRow({ id: 'off-page' }));
    render(<MapPinCard id="off-page" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('temporarily unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText(ADDRESS)).toBeInTheDocument();
    expect(getCard).toHaveBeenCalledTimes(2);
  });

  it('says a withdrawn home is gone and offers no retry', async () => {
    getCard.mockRejectedValue(
      new ListingsApiError('This listing is no longer available.', 'not_found', 404),
    );
    render(<MapPinCard id="gone" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('no longer available');
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('opens the detail on a click on the card, and not on a heart click', async () => {
    getCard.mockResolvedValue(aListingCardRow({ id: 'off-page' }));
    render(<MapPinCard id="off-page" />);
    await screen.findByText(ADDRESS);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(mockToggleSave).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'off-page', propertyId: expect.any(String) }),
    );
    expect(getListingPanel()).toBeNull();

    fireEvent.click(screen.getByText(ADDRESS));
    await waitFor(() => expect(getListingPanel()?.id).toBe('off-page'));
  });

  it('does not open the detail on a share click', async () => {
    getCard.mockResolvedValue(aListingCardRow({ id: 'off-page' }));
    render(<MapPinCard id="off-page" />);
    await screen.findByText(ADDRESS);

    fireEvent.click(screen.getByRole('button', { name: 'Share this listing' }));
    expect(getListingPanel()).toBeNull();
  });

  it('shows a seller-withheld address as the card does, with no street and no ZIP', async () => {
    getCard.mockResolvedValue(
      aListingCardRow({
        id: 'masked',
        address: null,
        city: 'BETHESDA',
        latitude: null,
        longitude: null,
      }),
    );
    render(<MapPinCard id="masked" />);

    expect(await screen.findByText('Bethesda, MD')).toBeInTheDocument();
    expect(screen.queryByText(/20814/)).not.toBeInTheDocument();
  });
});
