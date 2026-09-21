import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AuthForm from './AuthForm';
import {
  getConfirmationExpiryHours,
  RateLimitError,
  requestPasswordReset,
  resendConfirmationEmail,
  SignInFailedError,
} from '@/lib/api/account';

const login = jest.fn();
const signup = jest.fn();
jest.mock('@/lib/context', () => ({
  useApp: () => ({ login, signup }),
}));
const toast = jest.fn();
jest.mock('@/lib/useToast', () => ({ useToast: () => ({ toast }) }));

// Keeps the real error classes (RateLimitError carries retryAfterSeconds; SignInFailedError is
// how AuthForm tells a credential failure apart from a service failure) and mocks only the
// network calls.
jest.mock('@/lib/api/account', () => ({
  ...jest.requireActual('@/lib/api/account'),
  requestPasswordReset: jest.fn(),
  resendConfirmationEmail: jest.fn(),
  getConfirmationExpiryHours: jest.fn(),
}));

const mockRequestPasswordReset = requestPasswordReset as jest.MockedFunction<
  typeof requestPasswordReset
>;
const mockResendConfirmationEmail = resendConfirmationEmail as jest.MockedFunction<
  typeof resendConfirmationEmail
>;
const mockGetConfirmationExpiryHours = getConfirmationExpiryHours as jest.MockedFunction<
  typeof getConfirmationExpiryHours
>;

function fillSignup(email: string, password: string) {
  fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: email } });
  fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: password } });
}

const STRONG_PASSWORD = 'Str0ng!Pass';

describe('AuthForm', () => {
  beforeEach(() => {
    login.mockReset();
    signup.mockReset();
    toast.mockReset();
    mockResendConfirmationEmail.mockReset();
    mockGetConfirmationExpiryHours.mockReset().mockResolvedValue(24);
  });

  describe('signup mode legal links', () => {
    it('links both /terms and /privacy', () => {
      render(<AuthForm initialMode="signup" />);

      expect(screen.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute(
        'href',
        '/terms',
      );
      expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute(
        'href',
        '/privacy',
      );
    });

    /**
     * The content modules ship `isDraft: true` today (#156 has not landed), so this asserts the
     * copy that must render right now. Once approved copy ships, this test starts failing — the
     * signal to flip it to assert the "you agree to" wording instead.
     */
    it('does not claim a binding agreement while the linked pages are still drafts', () => {
      render(<AuthForm initialMode="signup" />);

      expect(screen.queryByText(/you agree to/i)).not.toBeInTheDocument();
      expect(screen.getByText(/draft, pending approval/i)).toBeInTheDocument();
    });

    it('does not render the legal links outside signup mode', () => {
      render(<AuthForm initialMode="login" />);

      expect(screen.queryByRole('link', { name: 'Terms of Service' })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Privacy Policy' })).not.toBeInTheDocument();
    });
  });

  describe('forgot mode', () => {
    beforeEach(() => {
      mockRequestPasswordReset.mockReset();
      toast.mockReset();
    });

    it('never calls alert()', () => {
      const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
      render(<AuthForm initialMode="forgot" />);

      fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
        target: { value: 'user@example.com' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Send Reset Link' }));

      expect(alertSpy).not.toHaveBeenCalled();
      alertSpy.mockRestore();
    });

    it('shows a neutral confirmation on a successful request, without revealing whether the account exists', async () => {
      mockRequestPasswordReset.mockResolvedValue(undefined);
      render(<AuthForm initialMode="forgot" />);

      fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
        target: { value: 'user@example.com' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Send Reset Link' }));

      await waitFor(() =>
        expect(mockRequestPasswordReset).toHaveBeenCalledWith('user@example.com'),
      );
      expect(await screen.findByText(/if an account exists for/i)).toBeInTheDocument();
      expect(screen.queryByPlaceholderText('you@example.com')).not.toBeInTheDocument();
    });

    it('shows a real failure state for a failed request', async () => {
      mockRequestPasswordReset.mockRejectedValue(new Error('network down'));
      render(<AuthForm initialMode="forgot" />);

      fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
        target: { value: 'user@example.com' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Send Reset Link' }));

      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith('We could not send the request. Try again.', 'error'),
      );
      // Still on the form. No confirmation was shown for a request that never went through.
      expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument();
    });

    it('surfaces a 429 using the server-provided Retry-After, not a guess', async () => {
      mockRequestPasswordReset.mockRejectedValue(new RateLimitError(42));
      render(<AuthForm initialMode="forgot" />);

      fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
        target: { value: 'user@example.com' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Send Reset Link' }));

      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith('Too many requests. Try again in 42 seconds.', 'error'),
      );
    });
  });

  describe('post-register waiting state', () => {
    it('shows the same waiting state for a new, unconfirmed, or already-confirmed address', async () => {
      signup.mockResolvedValue(undefined);
      render(<AuthForm initialMode="signup" />);

      fillSignup('user@example.com', STRONG_PASSWORD);
      fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

      await waitFor(() => expect(signup).toHaveBeenCalledWith('user@example.com', STRONG_PASSWORD));
      expect(await screen.findByText('Confirm your email')).toBeInTheDocument();
      expect(screen.getByText(/a confirmation link is on its way to/i)).toBeInTheDocument();
      expect(await screen.findByText(/it expires in 24 hours/i)).toBeInTheDocument();
      // Not signed in: registering never dispatches a session.
      expect(screen.queryByPlaceholderText('you@example.com')).not.toBeInTheDocument();
    });

    it('lets the consumer go back and use a different address', async () => {
      signup.mockResolvedValue(undefined);
      render(<AuthForm initialMode="signup" />);

      fillSignup('user@example.com', STRONG_PASSWORD);
      fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
      await screen.findByText('Confirm your email');

      fireEvent.click(screen.getByRole('button', { name: 'Use a different email' }));

      expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument();
    });

    it('reaches sign-in and forgot-password from the waiting state', async () => {
      signup.mockResolvedValue(undefined);
      render(<AuthForm initialMode="signup" />);

      fillSignup('user@example.com', STRONG_PASSWORD);
      fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
      await screen.findByText('Confirm your email');

      expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'reset your password' })).toBeInTheDocument();
    });

    it('resends on request and disables the control for the cooldown', async () => {
      signup.mockResolvedValue(undefined);
      mockResendConfirmationEmail.mockResolvedValue(undefined);
      render(<AuthForm initialMode="signup" />);

      fillSignup('user@example.com', STRONG_PASSWORD);
      fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
      await screen.findByText('Confirm your email');

      fireEvent.click(screen.getByRole('button', { name: 'Resend confirmation link' }));

      await waitFor(() => expect(mockResendConfirmationEmail).toHaveBeenCalledWith('user@example.com'));
      expect(await screen.findByRole('button', { name: /resend link \(60s\)/i })).toBeDisabled();
    });

    it('surfaces a resend 429 using the server-provided Retry-After', async () => {
      signup.mockResolvedValue(undefined);
      mockResendConfirmationEmail.mockRejectedValue(new RateLimitError(30));
      render(<AuthForm initialMode="signup" />);

      fillSignup('user@example.com', STRONG_PASSWORD);
      fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
      await screen.findByText('Confirm your email');

      fireEvent.click(screen.getByRole('button', { name: 'Resend confirmation link' }));

      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith('You can ask for another link in 30 seconds.', 'error'),
      );
    });
  });

  describe('sign-in failure', () => {
    it('offers both remedies neutrally, without asserting either cause', async () => {
      login.mockRejectedValue(new SignInFailedError());
      render(<AuthForm initialMode="login" />);

      fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
        target: { value: 'user@example.com' },
      });
      fireEvent.change(screen.getByPlaceholderText('••••••••'), {
        target: { value: 'whatever1' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

      expect(
        await screen.findByText('We could not sign you in with that email and password.'),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reset your password' })).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'resend your confirmation link' }),
      ).toBeInTheDocument();
      // Never claims the account exists or is unconfirmed.
      expect(screen.queryByText(/does not exist/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/unconfirmed/i)).not.toBeInTheDocument();
    });

    it('resends a confirmation link from the failure state', async () => {
      login.mockRejectedValue(new SignInFailedError());
      mockResendConfirmationEmail.mockResolvedValue(undefined);
      render(<AuthForm initialMode="login" />);

      fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
        target: { value: 'user@example.com' },
      });
      fireEvent.change(screen.getByPlaceholderText('••••••••'), {
        target: { value: 'whatever1' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
      await screen.findByRole('button', { name: 'resend your confirmation link' });

      fireEvent.click(screen.getByRole('button', { name: 'resend your confirmation link' }));

      await waitFor(() => expect(mockResendConfirmationEmail).toHaveBeenCalledWith('user@example.com'));
    });

    it('a service failure (not a credential failure) still uses the generic toast', async () => {
      login.mockRejectedValue(new Error('Sign-in service unavailable'));
      render(<AuthForm initialMode="login" />);

      fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
        target: { value: 'user@example.com' },
      });
      fireEvent.change(screen.getByPlaceholderText('••••••••'), {
        target: { value: 'whatever1' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith('Sign-in service unavailable', 'error'),
      );
      expect(
        screen.queryByText('We could not sign you in with that email and password.'),
      ).not.toBeInTheDocument();
    });
  });
});
