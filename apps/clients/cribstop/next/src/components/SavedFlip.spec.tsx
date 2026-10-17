import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { aListingCardRow } from '@/test/fixtures';
import { renderWithClient } from '@/test/renderWithClient';
import { store } from '@/lib/store/store';
import { login, logout } from '@/lib/store/slices/authSlice';
import { saveListing } from '@/lib/api/saved-homes';
import ListingCard from './ListingCard';

jest.mock('@/lib/api/saved-homes', () => ({
  listAllSavedHomes: jest.fn().mockResolvedValue([]),
  saveListing: jest.fn(),
  unsaveHomeById: jest.fn(),
}));

const mockedSave = saveListing as jest.Mock;
const HOME = 'aaaaaaaa-0000-4000-8000-000000000001';

function renderTwoListingsOfOneHome() {
  renderWithClient(
    <Provider store={store}>
      <ListingCard listing={aListingCardRow({ id: 'listing-1', propertyId: HOME })} />
      <ListingCard listing={aListingCardRow({ id: 'listing-2', propertyId: HOME })} />
    </Provider>,
  );
}

describe('saving a home flips every listing of that home (#25)', () => {
  afterEach(() => {
    act(() => {
      store.dispatch(logout());
    });
    mockedSave.mockReset();
  });

  it('flips both cards with one click, signed out', async () => {
    renderTwoListingsOfOneHome();
    expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(2);

    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);

    // Query notifies observers on the next tick, so the flip shows within the same frame.
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Unsave' })).toHaveLength(2));
    expect(mockedSave).not.toHaveBeenCalled();
  });

  it('rolls both cards back together when the signed-in save fails', async () => {
    mockedSave.mockImplementation(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error('down')), 100)),
    );
    act(() => {
      store.dispatch(login({ email: 'a@example.com' }));
    });
    renderTwoListingsOfOneHome();

    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Unsave' })).toHaveLength(2));

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(2));
    expect(store.getState().toast.toasts).toHaveLength(1);
  });
});
