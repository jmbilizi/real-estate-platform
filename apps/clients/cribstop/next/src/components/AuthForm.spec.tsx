import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AuthForm from './AuthForm';
import { RateLimitError, requestPasswordReset } from '@/lib/api/account';

jest.mock('@/lib/context', () => ({
  useApp: () => ({ login: jest.fn(), signup: jest.fn() }),
}));
const toast = jest.fn();
jest.mock('@/lib/useToast', () => ({ useToast: () => ({ toast }) }));

// Keeps the real RateLimitError class (its instances carry retryAfterSeconds) and mocks only the
// network call.
jest.mock('@/lib/api/account', () => ({
  ...jest.requireActual('@/lib/api/account'),
  requestPasswordReset: jest.fn(),
}));

const mockRequestPasswordReset = requestPasswordReset as jest.MockedFunction<
  typeof requestPasswordReset
>;

describe('AuthForm', () => {
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
});
