import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AuthForm from './AuthForm';
import {
  changeSignupEmail,
  CodesUnavailableError,
  identifyEmail,
  RateLimitError,
  requestPasswordReset,
  resendSignupCode,
  SignInFailedError,
  verifySignupCode,
} from '@/lib/api/account';

const login = jest.fn();
const completeSignup = jest.fn();
jest.mock('@/lib/context', () => ({
  useApp: () => ({ login, completeSignup }),
}));
const toast = jest.fn();
jest.mock('@/lib/useToast', () => ({ useToast: () => ({ toast }) }));

// Keeps the real error classes and mocks only the network calls.
jest.mock('@/lib/api/account', () => ({
  ...jest.requireActual('@/lib/api/account'),
  identifyEmail: jest.fn(),
  verifySignupCode: jest.fn(),
  resendSignupCode: jest.fn(),
  changeSignupEmail: jest.fn(),
  requestPasswordReset: jest.fn(),
  getPasswordMinLength: jest.fn().mockResolvedValue(15),
}));

const mockIdentify = identifyEmail as jest.MockedFunction<typeof identifyEmail>;
const mockVerify = verifySignupCode as jest.MockedFunction<typeof verifySignupCode>;
const mockResend = resendSignupCode as jest.MockedFunction<typeof resendSignupCode>;
const mockChangeEmail = changeSignupEmail as jest.MockedFunction<typeof changeSignupEmail>;
const mockRequestPasswordReset = requestPasswordReset as jest.MockedFunction<
  typeof requestPasswordReset
>;

const EMAIL = 'user@example.com';
const GOOD_PASSWORD = 'a long passphrase here';

function typeEmail(value: string) {
  fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value } });
}

async function continueWith(next: 'password' | 'code', email = EMAIL) {
  mockIdentify.mockResolvedValue({ next, resendAfterSeconds: 30, expiresInSeconds: 600 });
  typeEmail(email);
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByRole('heading', {
    name: next === 'password' ? 'Welcome back' : 'Check your email',
  });
}

async function reachSetPassword() {
  mockVerify.mockResolvedValue({ ok: true, signupProof: 'proof-1' });
  await continueWith('code');
  fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '123456' } });
  await screen.findByLabelText('Set your password');
}

describe('AuthForm', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (jest.requireMock('@/lib/api/account').getPasswordMinLength as jest.Mock).mockResolvedValue(15);
  });

  describe('email step', () => {
    it('shows one email field and Continue, with no sign-in or sign-up tabs', () => {
      render(<AuthForm />);

      expect(screen.getByRole('heading', { name: "What's your email?" })).toBeInTheDocument();
      expect(screen.getAllByRole('textbox')).toHaveLength(1);
      expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
      expect(screen.queryByRole('tab')).not.toBeInTheDocument();
      expect(screen.queryByPlaceholderText('••••••••')).not.toBeInTheDocument();
    });

    it('sets the email field attributes for mobile keyboards and password managers', () => {
      render(<AuthForm />);

      const field = screen.getByPlaceholderText('you@example.com');
      expect(field).toHaveAttribute('type', 'email');
      expect(field).toHaveAttribute('autocomplete', 'username');
      expect(field).toHaveAttribute('inputmode', 'email');
      expect(field).toHaveAttribute('autocapitalize', 'none');
      expect(field).toHaveAttribute('spellcheck', 'false');
    });

    it('links both legal pages and does not claim agreement while they are drafts', () => {
      render(<AuthForm />);

      expect(screen.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute(
        'href',
        '/terms',
      );
      expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute(
        'href',
        '/privacy',
      );
      expect(screen.queryByText(/you agree to/i)).not.toBeInTheDocument();
      expect(screen.getByText(/draft, pending approval/i)).toBeInTheDocument();
    });

    it('focuses the email field on first render', () => {
      render(<AuthForm />);
      expect(screen.getByPlaceholderText('you@example.com')).toHaveFocus();
    });

    it('shows the wait time from a 429, not raw error text', async () => {
      mockIdentify.mockRejectedValue(new RateLimitError(42));
      render(<AuthForm />);
      typeEmail(EMAIL);
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

      expect(
        await screen.findByText('Too many tries. Try again in 42 seconds.'),
      ).toBeInTheDocument();
      expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument();
    });

    it('shows the unavailable copy for a 503', async () => {
      mockIdentify.mockRejectedValue(new CodesUnavailableError());
      render(<AuthForm />);
      typeEmail(EMAIL);
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

      expect(await screen.findByText(/Sign-up is unavailable right now/)).toBeInTheDocument();
    });

    it('shows a generic message for any other failure', async () => {
      mockIdentify.mockRejectedValue(new Error('boom'));
      render(<AuthForm />);
      typeEmail(EMAIL);
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

      expect(await screen.findByText('Something went wrong. Try again.')).toBeInTheDocument();
      expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
    });
  });

  describe('password step (returning user)', () => {
    it('shows the email, a Change email link and current-password autocomplete', async () => {
      render(<AuthForm />);
      await continueWith('password');

      expect(mockIdentify).toHaveBeenCalledWith(EMAIL);
      expect(screen.getByText(EMAIL)).toBeInTheDocument();
      expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
      expect(screen.getByLabelText('Password')).toHaveFocus();
      expect(screen.getByRole('button', { name: 'Forgot password?' })).toBeInTheDocument();
      expect(screen.getByLabelText('Remember me')).toBeInTheDocument();
    });

    it('signs in and calls onSuccess', async () => {
      login.mockResolvedValue(undefined);
      const onSuccess = jest.fn();
      render(<AuthForm onSuccess={onSuccess} />);
      await continueWith('password');

      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'whatever' } });
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

      await waitFor(() => expect(login).toHaveBeenCalledWith(EMAIL, 'whatever', false));
      await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    });

    it('shows one generic message for a wrong password, naming no cause', async () => {
      login.mockRejectedValue(new SignInFailedError());
      render(<AuthForm />);
      await continueWith('password');

      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'whatever' } });
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

      expect(
        await screen.findByText('We could not sign you in with that email and password.'),
      ).toBeInTheDocument();
      expect(screen.queryByText(/locked|unconfirmed|does not exist/i)).not.toBeInTheDocument();
    });

    it('uses the generic toast for a service failure', async () => {
      login.mockRejectedValue(new Error('Sign-in service unavailable'));
      render(<AuthForm />);
      await continueWith('password');

      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'whatever' } });
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith('Sign-in service unavailable', 'error'),
      );
    });

    it('returns to the email step with the field filled and drops the typed password', async () => {
      render(<AuthForm />);
      await continueWith('password');
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });

      fireEvent.click(screen.getByRole('button', { name: 'Change email' }));

      expect(screen.getByPlaceholderText('you@example.com')).toHaveValue(EMAIL);
      await continueWith('password');
      expect(screen.getByLabelText('Password')).toHaveValue('');
    });

    it('opens the reset screen from Forgot password', async () => {
      mockRequestPasswordReset.mockResolvedValue(undefined);
      render(<AuthForm />);
      await continueWith('password');

      fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
      expect(screen.getByRole('heading', { name: 'Reset your password' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Send Reset Link' }));

      await waitFor(() => expect(mockRequestPasswordReset).toHaveBeenCalledWith(EMAIL));
      expect(await screen.findByText(/if an account exists for/i)).toBeInTheDocument();
    });
  });

  describe('forgot mode', () => {
    it('shows a neutral confirmation without revealing whether the account exists', async () => {
      mockRequestPasswordReset.mockResolvedValue(undefined);
      render(<AuthForm initialMode="forgot" />);

      typeEmail(EMAIL);
      fireEvent.click(screen.getByRole('button', { name: 'Send Reset Link' }));

      expect(await screen.findByText(/if an account exists for/i)).toBeInTheDocument();
    });

    it('surfaces a 429 using the server Retry-After', async () => {
      mockRequestPasswordReset.mockRejectedValue(new RateLimitError(42));
      render(<AuthForm initialMode="forgot" />);

      typeEmail(EMAIL);
      fireEvent.click(screen.getByRole('button', { name: 'Send Reset Link' }));

      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith('Too many requests. Try again in 42 seconds.', 'error'),
      );
    });

    it('shows a failure toast and stays on the form for a failed request', async () => {
      mockRequestPasswordReset.mockRejectedValue(new Error('network down'));
      render(<AuthForm initialMode="forgot" />);

      typeEmail(EMAIL);
      fireEvent.click(screen.getByRole('button', { name: 'Send Reset Link' }));

      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith('We could not send the request. Try again.', 'error'),
      );
      expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument();
    });
  });

  describe('code step (new user)', () => {
    it('asks for a 6-digit code with the right input attributes', async () => {
      render(<AuthForm />);
      await continueWith('code');

      expect(screen.getByText(/We sent a 6-digit code to/)).toBeInTheDocument();
      expect(screen.getByText(EMAIL)).toBeInTheDocument();
      const field = screen.getByLabelText('6-digit code');
      expect(field).toHaveAttribute('autocomplete', 'one-time-code');
      expect(field).toHaveAttribute('inputmode', 'numeric');
      expect(field).toHaveAttribute('pattern', '[0-9]*');
      expect(field).toHaveAttribute('maxlength', '6');
      expect(field).toHaveFocus();
    });

    it('accepts a paste with spaces and dashes and submits at six digits', async () => {
      mockVerify.mockResolvedValue({ ok: false, attemptsLeft: 2 });
      render(<AuthForm />);
      await continueWith('code');

      fireEvent.paste(screen.getByLabelText('6-digit code'), {
        clipboardData: { getData: () => '123 456' },
      });

      await waitFor(() => expect(mockVerify).toHaveBeenCalledWith(EMAIL, '123456'));
    });

    it('keeps digits only when typing', async () => {
      render(<AuthForm />);
      await continueWith('code');

      fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '12a-3' } });

      expect(screen.getByLabelText('6-digit code')).toHaveValue('123');
      expect(mockVerify).not.toHaveBeenCalled();
    });

    it('shows the tries left for a wrong code', async () => {
      mockVerify.mockResolvedValue({ ok: false, attemptsLeft: 3 });
      render(<AuthForm />);
      await continueWith('code');

      fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '000000' } });

      expect(await screen.findByText('That code did not work. 3 tries left.')).toBeInTheDocument();
      expect(screen.getByLabelText('6-digit code')).toHaveValue('');
    });

    it('shows the wait time for a lock', async () => {
      mockVerify.mockRejectedValue(new RateLimitError(120));
      render(<AuthForm />);
      await continueWith('code');

      fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '000000' } });

      expect(
        await screen.findByText('Too many tries. Try again in 120 seconds.'),
      ).toBeInTheDocument();
    });

    it('shows the unavailable copy for a 503 on verify', async () => {
      mockVerify.mockRejectedValue(new CodesUnavailableError());
      render(<AuthForm />);
      await continueWith('code');

      fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '000000' } });

      expect(await screen.findByText(/Sign-up is unavailable right now/)).toBeInTheDocument();
    });

    describe('timers', () => {
      beforeEach(() => jest.useFakeTimers());
      afterEach(() => jest.useRealTimers());

      it('counts down to a resend, then sends a new code and says the old one is void', async () => {
        mockIdentify.mockResolvedValue({
          next: 'code',
          resendAfterSeconds: 3,
          expiresInSeconds: 600,
        });
        mockResend.mockResolvedValue({ resendAfterSeconds: 30, expiresInSeconds: 600 });
        render(<AuthForm />);
        typeEmail(EMAIL);
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
        });

        const resend = screen.getByRole('button', { name: /Send a new code/ });
        expect(resend).toBeDisabled();
        expect(resend).toHaveTextContent('Send a new code in 3s');

        await act(async () => {
          jest.advanceTimersByTime(3000);
        });
        expect(screen.getByRole('button', { name: 'Send a new code' })).toBeEnabled();

        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: 'Send a new code' }));
        });

        expect(mockResend).toHaveBeenCalledWith(EMAIL);
        expect(screen.getByText('New code sent. The old one no longer works.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Send a new code in 30s/ })).toBeDisabled();
      });

      it('says the code expired at the expiry time', async () => {
        mockIdentify.mockResolvedValue({
          next: 'code',
          resendAfterSeconds: 0,
          expiresInSeconds: 5,
        });
        render(<AuthForm />);
        typeEmail(EMAIL);
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
        });

        await act(async () => {
          jest.advanceTimersByTime(5000);
        });

        expect(screen.getByText('That code expired. Send a new one.')).toBeInTheDocument();
      });
    });

    it('goes back to the email step with the field filled', async () => {
      render(<AuthForm />);
      await continueWith('code');

      fireEvent.click(screen.getByRole('button', { name: 'Change email' }));

      expect(screen.getByPlaceholderText('you@example.com')).toHaveValue(EMAIL);
    });

    it('calls change-email when the address changes after a code was sent', async () => {
      mockChangeEmail.mockResolvedValue({ resendAfterSeconds: 30, expiresInSeconds: 600 });
      render(<AuthForm />);
      await continueWith('code');
      fireEvent.click(screen.getByRole('button', { name: 'Change email' }));

      typeEmail('new@example.com');
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

      await waitFor(() => expect(mockChangeEmail).toHaveBeenCalledWith(EMAIL, 'new@example.com'));
      expect(await screen.findByText('new@example.com')).toBeInTheDocument();
      expect(mockIdentify).toHaveBeenLastCalledWith('new@example.com');
    });

    it('routes to the password step when the changed address already has an account', async () => {
      render(<AuthForm />);
      await continueWith('code');
      fireEvent.click(screen.getByRole('button', { name: 'Change email' }));

      mockIdentify.mockResolvedValue({
        next: 'password',
        resendAfterSeconds: 0,
        expiresInSeconds: 0,
      });
      typeEmail('old@example.com');
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

      expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
      expect(mockChangeEmail).not.toHaveBeenCalled();
    });
  });

  describe('set-password step', () => {
    it('shows the length rule and keeps Create account disabled until both fields match', async () => {
      render(<AuthForm />);
      await reachSetPassword();

      expect(screen.getByLabelText('Set your password')).toHaveAttribute(
        'autocomplete',
        'new-password',
      );
      expect(screen.getByLabelText('Confirm password')).toHaveAttribute(
        'autocomplete',
        'new-password',
      );
      expect(screen.getByText('15 or more characters. A phrase works.')).toBeInTheDocument();
      const create = screen.getByRole('button', { name: 'Create account' });
      expect(create).toBeDisabled();

      fireEvent.change(screen.getByLabelText('Set your password'), { target: { value: 'short' } });
      fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'short' } });
      expect(create).toBeDisabled();

      fireEvent.change(screen.getByLabelText('Set your password'), {
        target: { value: GOOD_PASSWORD },
      });
      expect(create).toBeDisabled();
      fireEvent.change(screen.getByLabelText('Confirm password'), {
        target: { value: GOOD_PASSWORD },
      });
      expect(create).toBeEnabled();
    });

    it('toggles password visibility', async () => {
      render(<AuthForm />);
      await reachSetPassword();

      expect(screen.getByLabelText('Set your password')).toHaveAttribute('type', 'password');
      fireEvent.click(screen.getByRole('button', { name: 'Show passwords' }));
      expect(screen.getByLabelText('Set your password')).toHaveAttribute('type', 'text');
      expect(screen.getByLabelText('Confirm password')).toHaveAttribute('type', 'text');
    });

    function fillAndSubmit() {
      fireEvent.change(screen.getByLabelText('Set your password'), {
        target: { value: GOOD_PASSWORD },
      });
      fireEvent.change(screen.getByLabelText('Confirm password'), {
        target: { value: GOOD_PASSWORD },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    }

    it('signs the user in and calls onSuccess', async () => {
      completeSignup.mockResolvedValue({ ok: true, session: { email: EMAIL } });
      const onSuccess = jest.fn();
      render(<AuthForm onSuccess={onSuccess} />);
      await reachSetPassword();

      fillAndSubmit();

      await waitFor(() =>
        expect(completeSignup).toHaveBeenCalledWith(EMAIL, 'proof-1', GOOD_PASSWORD),
      );
      await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    });

    it('shows friendly copy for a breached password', async () => {
      completeSignup.mockResolvedValue({
        ok: false,
        reason: 'password_rejected',
        errors: ['breached'],
      });
      render(<AuthForm />);
      await reachSetPassword();

      fillAndSubmit();

      expect(
        await screen.findByText('That password has leaked before. Pick another.'),
      ).toBeInTheDocument();
    });

    it('shows friendly copy for a too-short password', async () => {
      completeSignup.mockResolvedValue({
        ok: false,
        reason: 'password_rejected',
        errors: ['too_short'],
      });
      render(<AuthForm />);
      await reachSetPassword();

      fillAndSubmit();

      expect(
        await screen.findByText('That password is too short. Use 15 or more characters.'),
      ).toBeInTheDocument();
    });

    it('returns to the email step when the proof is no longer valid', async () => {
      completeSignup.mockResolvedValue({ ok: false, reason: 'invalid_proof' });
      render(<AuthForm />);
      await reachSetPassword();

      fillAndSubmit();

      expect(await screen.findByText('That sign-up timed out. Start again.')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument();
    });

    it('returns to the email step with neutral copy when the email is unavailable', async () => {
      completeSignup.mockResolvedValue({ ok: false, reason: 'email_unavailable' });
      render(<AuthForm />);
      await reachSetPassword();

      fillAndSubmit();

      expect(await screen.findByText(/We could not finish sign-up/)).toBeInTheDocument();
    });

    it('never puts the proof or password in the URL or in storage', async () => {
      completeSignup.mockResolvedValue({ ok: true, session: { email: EMAIL } });
      render(<AuthForm onSuccess={jest.fn()} />);
      await reachSetPassword();
      fillAndSubmit();
      await waitFor(() => expect(completeSignup).toHaveBeenCalled());

      expect(window.location.href).not.toContain('proof-1');
      expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toMatch(
        /proof-1|passphrase/,
      );
    });
  });
});
