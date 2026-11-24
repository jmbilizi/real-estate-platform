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

  it('saves nothing for a signed-out visitor and opens the sign-in modal with the reason', () => {
    const pushState = jest.spyOn(window.history, 'pushState').mockImplementation(() => undefined);
    renderTwoListingsOfOneHome();

    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);

    expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Unsave' })).toBeNull();
    expect(mockedSave).not.toHaveBeenCalled();
    expect(String(pushState.mock.calls[0][2])).toContain('modal=login');
    expect(String(pushState.mock.calls[0][2])).toContain('reason=save');
    pushState.mockRestore();
  });

  // The signed-in flip of both cards is the first half of this test.
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
