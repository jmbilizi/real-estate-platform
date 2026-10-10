import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import OnboardingModal from './OnboardingModal';
import { updateProfile } from '@/lib/api/account';
import { getNotificationPreferences, optInToEmail } from '@/lib/api/notification-preferences';
import { addToast } from '@/lib/store/slices/toastSlice';

const dispatch = jest.fn();
jest.mock('@/lib/store/hooks', () => ({ useAppDispatch: () => dispatch }));
jest.mock('@/lib/api/account', () => ({ updateProfile: jest.fn() }));
jest.mock('@/lib/api/notification-preferences', () => ({
  getNotificationPreferences: jest.fn(),
  optInToEmail: jest.fn(),
}));

const mockProfile = updateProfile as jest.Mock;
const mockWording = getNotificationPreferences as jest.Mock;
const mockOptIn = optInToEmail as jest.Mock;
const WORDING = { id: 'email_non_transactional', version: 1, text: 'Send me Cribstop emails.' };

function openPreferencesStep() {
  render(<OnboardingModal open />);
  fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
}
function emailToggle() {
  return screen.getByRole('checkbox', { name: /Email updates/ });
}

describe('OnboardingModal email consent', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockWording.mockResolvedValue({ consentWording: WORDING, preferences: [] });
    mockOptIn.mockResolvedValue(undefined);
    mockProfile.mockResolvedValue(undefined);
  });

  it('turning email on shows the server wording and opts in with its id', async () => {
    openPreferencesStep();
    fireEvent.click(emailToggle());

    expect(await screen.findByText(WORDING.text)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done!' }));

    await waitFor(() => expect(mockOptIn).toHaveBeenCalledWith(WORDING.id));
    expect(mockProfile).toHaveBeenCalledWith(
      expect.objectContaining({ emailNotificationsEnabled: undefined }),
    );
  });

  it('leaving email off sends a plain profile update and no opt-in', async () => {
    openPreferencesStep();
    expect(mockWording).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Done!' }));

    await waitFor(() => expect(mockProfile).toHaveBeenCalled());
    expect(mockProfile).toHaveBeenCalledWith(
      expect.objectContaining({ emailNotificationsEnabled: false }),
    );
    expect(mockOptIn).not.toHaveBeenCalled();
  });

  it('shows an error toast and skips the profile update when the opt-in fails', async () => {
    mockOptIn.mockRejectedValue(new Error('Could not turn on email notifications'));
    openPreferencesStep();
    fireEvent.click(emailToggle());
    await screen.findByText(WORDING.text);
    fireEvent.click(screen.getByRole('button', { name: 'Done!' }));

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
    expect(mockProfile).not.toHaveBeenCalled();
  });

  it('tells the user when the wording cannot load, and sends no opt-in', async () => {
    mockWording.mockRejectedValue(new Error('down'));
    openPreferencesStep();
    fireEvent.click(emailToggle());

    expect(await screen.findByText(/could not load the consent wording/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done!' }));
    await waitFor(() => expect(dispatch).toHaveBeenCalled());
    expect(mockOptIn).not.toHaveBeenCalled();
  });
});
