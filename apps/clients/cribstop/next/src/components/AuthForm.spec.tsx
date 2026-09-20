import { render, screen } from '@testing-library/react';
import AuthForm from './AuthForm';

jest.mock('@/lib/context', () => ({
  useApp: () => ({ login: jest.fn(), signup: jest.fn() }),
}));
jest.mock('@/lib/useToast', () => ({ useToast: () => ({ toast: jest.fn() }) }));

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
});
