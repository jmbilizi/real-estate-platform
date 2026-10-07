import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AccountSecuritySection from './AccountSecuritySection';
import {
  changePassword,
  getPasswordMinLength,
  startEmailChange,
  verifyEmailChange,
} from '@/lib/api/account';

const dispatch = jest.fn();
jest.mock('@/lib/store/hooks', () => ({
  useAppDispatch: () => dispatch,
  useAppSelector: () => ({ name: 'old@example.com', email: 'old@example.com' }),
}));
jest.mock('@/lib/api/account', () => ({
  ...jest.requireActual('@/lib/api/account'),
  startEmailChange: jest.fn(),
  verifyEmailChange: jest.fn(),
  changePassword: jest.fn(),
  getPasswordMinLength: jest.fn().mockResolvedValue(15),
}));

const mockStart = startEmailChange as jest.MockedFunction<typeof startEmailChange>;
const mockVerify = verifyEmailChange as jest.MockedFunction<typeof verifyEmailChange>;
const mockChangePassword = changePassword as jest.MockedFunction<typeof changePassword>;
const TIMING = { resendAfterSeconds: 30, expiresInSeconds: 600 };

function openEmail() {
  render(<AccountSecuritySection />);
  fireEvent.click(screen.getByRole('button', { name: 'Change email' }));
}
function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function press(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
}

describe('AccountSecuritySection', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (getPasswordMinLength as jest.Mock).mockResolvedValue(15);
  });

  it('shows the email and a password row, each with a Change button', () => {
    render(<AccountSecuritySection />);
    expect(screen.getByText('old@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change email' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change password' })).toBeInTheDocument();
  });

  describe('change email with the password', () => {
    it('walks password, new email, code, done, and renews the session', async () => {
      mockStart.mockResolvedValue({ ok: true, stepUp: null, ...TIMING });
      mockVerify.mockResolvedValue({ ok: true, email: 'new@example.com', accessToken: 't' });
      openEmail();

      const password = screen.getByLabelText('Current password');
      expect(password).toHaveAttribute('autocomplete', 'current-password');
      expect(password).toHaveFocus();
      fill('Current password', 'my pw');
      press('Continue');

      fill('New email address', 'new@example.com');
      press('Continue');
      await waitFor(() =>
        expect(mockStart).toHaveBeenCalledWith({
          newEmail: 'new@example.com',
          currentPassword: 'my pw',
        }),
      );

      expect(
        await screen.findByText(/If that address can be used, we sent a code to new@example.com/),
      ).toBeInTheDocument();
      const code = screen.getByLabelText('Code from your new email');
      expect(code).toHaveAttribute('autocomplete', 'one-time-code');
      expect(code).toHaveAttribute('inputmode', 'numeric');
      fireEvent.change(code, { target: { value: '123456' } });

      expect(
        await screen.findByText(/We emailed your old address about this change/),
      ).toBeInTheDocument();
      expect(mockVerify).toHaveBeenCalledWith('123456', 'new@example.com');
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ payload: { email: 'new@example.com', accessToken: 't' } }),
      );
    });

    it('returns to the password step with the tries left when the password is wrong', async () => {
      mockStart.mockResolvedValue({ ok: false, reason: 'step_up_failed', attemptsLeft: 2 });
      openEmail();
      fill('Current password', 'bad');
      press('Continue');
      fill('New email address', 'new@example.com');
      press('Continue');

      expect(
        await screen.findByText('That password did not work. 2 tries left.'),
      ).toBeInTheDocument();
      expect(screen.getByLabelText('Current password')).toHaveValue('');
    });
  });

  describe('change email with a code at the current address', () => {
    it('asks for the old-address code, then the new-address code', async () => {
      mockStart
        .mockResolvedValueOnce({ ok: true, stepUp: 'oldEmailCode', ...TIMING })
        .mockResolvedValueOnce({ ok: true, stepUp: null, ...TIMING });
      mockVerify.mockResolvedValue({ ok: true, email: 'new@example.com' });
      openEmail();

      press('Email a code to my current address instead');
      fill('New email address', 'new@example.com');
      press('Continue');
      await waitFor(() => expect(mockStart).toHaveBeenCalledWith({ newEmail: 'new@example.com' }));

      fireEvent.change(await screen.findByLabelText('Code from your current email'), {
        target: { value: '111111' },
      });
      await waitFor(() =>
        expect(mockStart).toHaveBeenLastCalledWith({
          newEmail: 'new@example.com',
          oldEmailCode: '111111',
        }),
      );

      fireEvent.change(await screen.findByLabelText('Code from your new email'), {
        target: { value: '222222' },
      });
      expect(
        await screen.findByText(/We emailed your old address about this change/),
      ).toBeInTheDocument();
      // The old-address code is spent, so the new-address step offers no resend.
      expect(screen.queryByRole('button', { name: /Send a new code/ })).not.toBeInTheDocument();
    });
  });

  describe('change password', () => {
    function openPassword() {
      render(<AccountSecuritySection />);
      fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    }

    it('uses the autocomplete tokens and blocks a mismatch', async () => {
      openPassword();
      expect(screen.getByLabelText('Current password')).toHaveAttribute(
        'autocomplete',
        'current-password',
      );
      expect(screen.getByLabelText('New password')).toHaveAttribute('autocomplete', 'new-password');
      expect(screen.getByLabelText('Confirm new password')).toHaveAttribute(
        'autocomplete',
        'new-password',
      );
      fill('Current password', 'old');
      fill('New password', 'a long passphrase here');
      fill('Confirm new password', 'a long passphrase hexe');
      expect(screen.getByText('The passwords do not match yet.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Update password' })).toBeDisabled();
    });

    it('toggles show and hide', () => {
      openPassword();
      expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'password');
      press('Show passwords');
      expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'text');
    });

    it('says other devices were signed out on success', async () => {
      mockChangePassword.mockResolvedValue({
        ok: true,
        email: 'old@example.com',
        accessToken: 't',
      });
      openPassword();
      fill('Current password', 'old');
      fill('New password', 'a long passphrase here');
      fill('Confirm new password', 'a long passphrase here');
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Update password' })).toBeEnabled(),
      );
      press('Update password');

      expect(await screen.findByText('Other devices were signed out.')).toBeInTheDocument();
      expect(mockChangePassword).toHaveBeenCalledWith({
        currentPassword: 'old',
        newPassword: 'a long passphrase here',
      });
    });

    it('shows neutral copy for a wrong current password and a weak new one', async () => {
      mockChangePassword
        .mockResolvedValueOnce({ ok: false, reason: 'wrong_password' })
        .mockResolvedValueOnce({ ok: false, reason: 'password_rejected', errors: ['breached'] });
      openPassword();
      for (let i = 0; i < 2; i++) {
        fill('Current password', 'old');
        fill('New password', 'a long passphrase here');
        fill('Confirm new password', 'a long passphrase here');
        await waitFor(() =>
          expect(screen.getByRole('button', { name: 'Update password' })).toBeEnabled(),
        );
        press('Update password');
        await screen.findByRole('alert');
      }
      expect(screen.getByRole('alert')).toHaveTextContent('That password has leaked before.');
    });
  });
});
