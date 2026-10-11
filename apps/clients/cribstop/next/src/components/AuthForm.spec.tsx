import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AuthForm from './AuthForm';
import {
  changeSignupEmail,
  CodesUnavailableError,
  completePasswordReset,
  identifyEmail,
  RateLimitError,
  resendSignupCode,
  SignInFailedError,
  startPasswordReset,
  verifyResetCode,
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
  startPasswordReset: jest.fn(),
  verifyResetCode: jest.fn(),
  completePasswordReset: jest.fn(),
  getPasswordMinLength: jest.fn().mockResolvedValue(15),
}));

const mockIdentify = identifyEmail as jest.MockedFunction<typeof identifyEmail>;
const mockVerify = verifySignupCode as jest.MockedFunction<typeof verifySignupCode>;
const mockResend = resendSignupCode as jest.MockedFunction<typeof resendSignupCode>;
const mockChangeEmail = changeSignupEmail as jest.MockedFunction<typeof changeSignupEmail>;
const mockStartReset = startPasswordReset as jest.MockedFunction<typeof startPasswordReset>;
const mockVerifyReset = verifyResetCode as jest.MockedFunction<typeof verifyResetCode>;
const mockCompleteReset = completePasswordReset as jest.MockedFunction<
  typeof completePasswordReset
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

      expect(screen.getByRole('heading', { name: 'Sign in or sign up' })).toBeInTheDocument();
      expect(screen.getAllByRole('textbox')).toHaveLength(1);
      expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
      expect(screen.queryByRole('tab')).not.toBeInTheDocument();
      expect(screen.queryByPlaceholderText('••••••••')).not.toBeInTheDocument();
    });

    it('puts the email field first, then "or", then Google and Apple on one row', () => {
      render(<AuthForm />);

      const email = screen.getByPlaceholderText('you@example.com');
      const or = screen.getByText('or');
      const google = screen.getByRole('button', { name: 'Continue with Google' });
      const apple = screen.getByRole('button', { name: 'Continue with Apple' });
      const follows = (x: Node, y: Node) =>
        Boolean(x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING);
      expect(follows(email, or)).toBe(true);
      expect(follows(or, google)).toBe(true);
      expect(google.parentElement).toBe(apple.parentElement);
      expect(google.parentElement).toHaveClass('grid-cols-2', 'gap-2');
      expect(google).toHaveAttribute('title', 'Continue with Google');
      expect(apple).toHaveAttribute('title', 'Continue with Apple');
      expect(screen.queryByText('Welcome back')).not.toBeInTheDocument();
    });

    it('labels the field inside it and shows the helper line only on focus or a value', () => {
      render(<AuthForm />);

      const field = screen.getByLabelText('Email');
      const help = () => screen.getByText('We may send you a code to confirm your email.');
      expect(field).toBe(screen.getByPlaceholderText('you@example.com'));
      // The step focuses the field on mount, so blur it to read the idle state.
      fireEvent.blur(field);
      expect(help()).toHaveClass('opacity-0');

      fireEvent.focus(field);
      expect(help()).toHaveClass('opacity-100');
      // The footer links the Privacy Policy once. The helper line has no link.
      expect(screen.getAllByRole('link', { name: 'Privacy Policy' })).toHaveLength(1);
      expect(field.getAttribute('aria-describedby')).toContain('auth-email-help');

      fireEvent.blur(field);
      expect(help()).toHaveClass('opacity-0');
      fireEvent.change(field, { target: { value: 'a@b.co' } });
      expect(help()).toHaveClass('opacity-100');
    });

    it('keeps the step layout identical before focus, on focus and after blur', () => {
      render(<AuthForm />);
      const field = screen.getByLabelText('Email');
      const form = field.closest('form') as HTMLElement;
      // Everything that can change a box size: tag, classes with the opacity and label-float
      // classes removed, and the node count. Opacity and the absolute label never move layout.
      const NON_LAYOUT = /\bopacity-\d+\b/g;
      const signature = () =>
        Array.from(form.querySelectorAll('*'))
          .filter((el) => el.tagName !== 'LABEL')
          .map((el) => `${el.tagName}.${(el.getAttribute('class') ?? '').replace(NON_LAYOUT, '')}`)
          .join('|');

      fireEvent.blur(field);
      const before = signature();
      const nodesBefore = form.querySelectorAll('*').length;
      fireEvent.focus(field);
      expect(signature()).toBe(before);
      expect(form.querySelectorAll('*').length).toBe(nodesBefore);
      fireEvent.blur(field);
      expect(signature()).toBe(before);
      expect(form.querySelectorAll('*').length).toBe(nodesBefore);
      // A constant 1px border plus a ring: focus never thickens the border.
      expect(field.className).not.toMatch(/focus:border-(2|4|\[)/);
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

    it('links both legal pages and states agreement', () => {
      render(<AuthForm />);

      expect(screen.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute(
        'href',
        '/terms',
      );
      for (const link of screen.getAllByRole('link', { name: 'Privacy Policy' })) {
        expect(link).toHaveAttribute('href', '/privacy');
      }
      expect(screen.getByText(/By continuing, you agree to our/i)).toBeInTheDocument();
      expect(screen.queryByText(/draft|pending/i)).not.toBeInTheDocument();
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

    it('opens the reset screen from Forgot password with the email filled in', async () => {
      render(<AuthForm />);
      await continueWith('password');

      fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));

      expect(screen.getByRole('heading', { name: 'Reset your password' })).toBeInTheDocument();
      expect(screen.getByPlaceholderText('you@example.com')).toHaveValue(EMAIL);
    });
  });

  describe('forgot and reset by code', () => {
    const TIMING = { resendAfterSeconds: 30, expiresInSeconds: 600 };

    async function reachResetCode(timing = TIMING) {
      mockStartReset.mockResolvedValue(timing);
      render(<AuthForm initialMode="forgot" />);
      typeEmail(EMAIL);
      fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
      await screen.findByLabelText('6-digit code');
    }

    async function reachResetPassword() {
      mockVerifyReset.mockResolvedValue({ ok: true, resetProof: 'reset-1' });
      await reachResetCode();
      fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '123456' } });
      await screen.findByLabelText('New password');
    }

    function fillNewPassword(value = GOOD_PASSWORD) {
      fireEvent.change(screen.getByLabelText('New password'), { target: { value } });
      fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value } });
      fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
    }

    it('shows neutral copy that never says whether the account exists', async () => {
      await reachResetCode();

      expect(mockStartReset).toHaveBeenCalledWith(EMAIL);
      expect(screen.getByText(/If an account exists for/)).toBeInTheDocument();
      expect(screen.getByText(EMAIL)).toBeInTheDocument();
    });

    it('uses the shared code field attributes and focuses it', async () => {
      await reachResetCode();

      const field = screen.getByLabelText('6-digit code');
      expect(field).toHaveAttribute('autocomplete', 'one-time-code');
      expect(field).toHaveAttribute('inputmode', 'numeric');
      expect(field).toHaveFocus();
    });

    it('shows the wait from a 429 on start', async () => {
      mockStartReset.mockRejectedValue(new RateLimitError(42));
      render(<AuthForm initialMode="forgot" />);
      typeEmail(EMAIL);
      fireEvent.click(screen.getByRole('button', { name: 'Send code' }));

      expect(
        await screen.findByText('Too many tries. Try again in 42 seconds.'),
      ).toBeInTheDocument();
    });

    it('shows a failure message and stays on the form when start fails', async () => {
      mockStartReset.mockRejectedValue(new Error('down'));
      render(<AuthForm initialMode="forgot" />);
      typeEmail(EMAIL);
      fireEvent.click(screen.getByRole('button', { name: 'Send code' }));

      expect(await screen.findByText('We could not send a code. Try again.')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument();
    });

    it('shows a wrong code with the tries left, using the reset endpoint', async () => {
      mockVerifyReset.mockResolvedValue({ ok: false, attemptsLeft: 4 });
      await reachResetCode();

      fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '000000' } });

      expect(await screen.findByText('That code did not work. 4 tries left.')).toBeInTheDocument();
      expect(mockVerifyReset).toHaveBeenCalledWith(EMAIL, '000000');
      expect(mockVerify).not.toHaveBeenCalled();
    });

    it('shows the lock wait from a 429 on verify', async () => {
      mockVerifyReset.mockRejectedValue(new RateLimitError(120));
      await reachResetCode();

      fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '123456' } });

      expect(
        await screen.findByText('Too many tries. Try again in 120 seconds.'),
      ).toBeInTheDocument();
    });

    it('disables resend during the countdown', async () => {
      await reachResetCode();
      expect(screen.getByRole('button', { name: 'Send a new code in 30s' })).toBeDisabled();
    });

    it('resends a code once the countdown is over', async () => {
      await reachResetCode({ resendAfterSeconds: 0, expiresInSeconds: 600 });
      mockStartReset.mockClear();
      mockStartReset.mockResolvedValue(TIMING);

      fireEvent.click(screen.getByRole('button', { name: 'Send a new code' }));

      expect(await screen.findByText('New code sent. The old one no longer works.')).toBeVisible();
      expect(mockStartReset).toHaveBeenCalledWith(EMAIL);
      expect(mockResend).not.toHaveBeenCalled();
    });

    it('goes back to the email field from Change email', async () => {
      await reachResetCode();

      fireEvent.click(screen.getByRole('button', { name: 'Change email' }));

      expect(screen.getByRole('heading', { name: 'Reset your password' })).toBeInTheDocument();
      expect(screen.getByPlaceholderText('you@example.com')).toHaveValue(EMAIL);
    });

    it('asks for a new password with both fields set to new-password', async () => {
      await reachResetPassword();

      expect(screen.getByRole('heading', { name: 'Set a new password' })).toBeInTheDocument();
      expect(screen.getByLabelText('New password')).toHaveAttribute('autocomplete', 'new-password');
      expect(screen.getByLabelText('Confirm password')).toHaveAttribute(
        'autocomplete',
        'new-password',
      );
      expect(screen.getByText(/15 or more characters/)).toBeInTheDocument();
    });

    it('keeps Update password disabled until both fields match and are long enough', async () => {
      await reachResetPassword();

      const update = screen.getByRole('button', { name: 'Update password' });
      expect(update).toBeDisabled();
      fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'short' } });
      fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'short' } });
      expect(update).toBeDisabled();
      fireEvent.change(screen.getByLabelText('New password'), { target: { value: GOOD_PASSWORD } });
      expect(update).toBeDisabled();
      fireEvent.change(screen.getByLabelText('Confirm password'), {
        target: { value: GOOD_PASSWORD },
      });
      expect(update).toBeEnabled();
    });

    it('toggles password visibility on both fields', async () => {
      await reachResetPassword();

      fireEvent.click(screen.getByRole('button', { name: 'Show passwords' }));

      expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'text');
      expect(screen.getByLabelText('Confirm password')).toHaveAttribute('type', 'text');
    });

    it('returns to the password step with the email filled in and signs nobody in', async () => {
      mockCompleteReset.mockResolvedValue({ ok: true });
      const onSuccess = jest.fn();
      mockVerifyReset.mockResolvedValue({ ok: true, resetProof: 'reset-1' });
      mockStartReset.mockResolvedValue(TIMING);
      render(<AuthForm initialMode="forgot" onSuccess={onSuccess} />);
      typeEmail(EMAIL);
      fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
      await screen.findByLabelText('6-digit code');
      fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '123456' } });
      await screen.findByLabelText('New password');

      fillNewPassword();

      await waitFor(() =>
        expect(mockCompleteReset).toHaveBeenCalledWith({
          email: EMAIL,
          resetProof: 'reset-1',
          newPassword: GOOD_PASSWORD,
        }),
      );
      expect(await screen.findByText('Password updated. Sign in again.')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
      expect(screen.getByText(EMAIL)).toBeInTheDocument();
      expect(screen.getByLabelText('Password')).toHaveFocus();
      expect(login).not.toHaveBeenCalled();
      expect(onSuccess).not.toHaveBeenCalled();
    });

    it.each([
      ['breached', 'That password has leaked before. Pick another.'],
      ['too_short', 'That password is too short. Use 15 or more characters.'],
      ['too_long', 'That password is too long. Shorten it.'],
    ] as const)('shows friendly copy for the %s policy error', async (code, copy) => {
      mockCompleteReset.mockResolvedValue({
        ok: false,
        reason: 'password_rejected',
        errors: [code],
      });
      await reachResetPassword();

      fillNewPassword();

      expect(await screen.findByText(copy)).toBeInTheDocument();
    });

    it('shows the wait from a 429 on complete', async () => {
      mockCompleteReset.mockRejectedValue(new RateLimitError(30));
      await reachResetPassword();
      fillNewPassword();

      expect(
        await screen.findByText('Too many tries. Try again in 30 seconds.'),
      ).toBeInTheDocument();
    });

    it('returns to the email field when the proof is no longer valid', async () => {
      mockCompleteReset.mockResolvedValue({ ok: false, reason: 'invalid_proof' });
      await reachResetPassword();
      fillNewPassword();

      expect(await screen.findByText('That reset timed out. Start again.')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Reset your password' })).toBeInTheDocument();
    });

    it('never puts the proof or password in the URL or in storage', async () => {
      mockCompleteReset.mockResolvedValue({ ok: true });
      await reachResetPassword();
      fillNewPassword();
      await waitFor(() => expect(mockCompleteReset).toHaveBeenCalled());

      expect(window.location.href).not.toContain('reset-1');
      expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toMatch(
        /reset-1|passphrase/,
      );
    });

    it('has no link-based reset copy left', () => {
      render(<AuthForm initialMode="forgot" />);
      expect(screen.queryByText(/reset link/i)).not.toBeInTheDocument();
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
