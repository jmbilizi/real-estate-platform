import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AccountPage from './page';
import { getProfile, updateProfile } from '@/lib/api/account';
import { getNotificationPreferences, optInToEmail } from '@/lib/api/notification-preferences';
import { addToast } from '@/lib/store/slices/toastSlice';

const dispatch = jest.fn();
const USER = {
  id: 'u1',
  email: 'a@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  emailNotificationsEnabled: false,
};
let currentUser = { ...USER };

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/context', () => ({
  useApp: () => ({ user: currentUser, logout: jest.fn() }),
}));
jest.mock('@/lib/store/hooks', () => ({
  useAppDispatch: () => dispatch,
  useAppSelector: () => currentUser,
}));
jest.mock('@/components/AccountSecuritySection', () => () => null);
jest.mock('@/components/LookingForSection', () => () => null);
jest.mock('@/lib/api/account', () => ({ getProfile: jest.fn(), updateProfile: jest.fn() }));
jest.mock('@/lib/api/notification-preferences', () => ({
  getNotificationPreferences: jest.fn(),
  optInToEmail: jest.fn(),
}));

const mockGetProfile = getProfile as jest.Mock;
const mockUpdate = updateProfile as jest.Mock;
const mockWording = getNotificationPreferences as jest.Mock;
const mockOptIn = optInToEmail as jest.Mock;
const WORDING = { id: 'email_non_transactional', version: 1, text: 'Send me Cribstop emails.' };

async function startEditing(emailOn: boolean) {
  currentUser = { ...USER, emailNotificationsEnabled: emailOn };
  mockGetProfile.mockResolvedValue({ ...currentUser });
  render(<AccountPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  await screen.findByRole('button', { name: 'Save changes' });
  return screen.getAllByRole('switch')[0];
}

describe('account page email consent', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockWording.mockResolvedValue({ consentWording: WORDING, preferences: [] });
    mockOptIn.mockResolvedValue(undefined);
    mockUpdate.mockResolvedValue(undefined);
  });

  it('turning email on shows the server wording and opts in with its id', async () => {
    const toggle = await startEditing(false);
    fireEvent.click(toggle);

    expect(await screen.findByText(WORDING.text)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mockOptIn).toHaveBeenCalledWith(WORDING.id));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(mockUpdate.mock.calls[0][0].emailNotificationsEnabled).toBeUndefined();
  });

  it('turning email off is a plain profile update with no opt-in call', async () => {
    const toggle = await startEditing(true);
    fireEvent.click(toggle);
    expect(mockWording).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(mockUpdate.mock.calls[0][0].emailNotificationsEnabled).toBe(false);
    expect(mockOptIn).not.toHaveBeenCalled();
  });

  it('keeps editing and shows an error toast when the opt-in fails', async () => {
    mockOptIn.mockRejectedValue(new Error('Could not turn on email notifications'));
    const toggle = await startEditing(false);
    fireEvent.click(toggle);
    await screen.findByText(WORDING.text);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: addToast.type,
          payload: expect.objectContaining({
            type: 'error',
            message: 'Could not turn on email notifications',
          }),
        }),
      ),
    );
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
  });
});
