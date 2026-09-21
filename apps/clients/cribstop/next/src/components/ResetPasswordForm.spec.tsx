import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ResetPasswordForm from './ResetPasswordForm';
import { confirmPasswordReset, PasswordResetError } from '@/lib/api/account';

const login = jest.fn();
jest.mock('@/lib/context', () => ({
  useApp: () => ({ login }),
}));
const toast = jest.fn();
jest.mock('@/lib/useToast', () => ({ useToast: () => ({ toast }) }));

// Keeps the real PasswordResetError/RateLimitError classes and mocks only the network call.
jest.mock('@/lib/api/account', () => ({
  ...jest.requireActual('@/lib/api/account'),
  confirmPasswordReset: jest.fn(),
}));

const mockConfirmPasswordReset = confirmPasswordReset as jest.MockedFunction<
  typeof confirmPasswordReset
>;

const VALID_PASSWORD = 'Str0ng!Pass';

function fillPasswords(newPassword: string, confirmPassword: string) {
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: newPassword } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), {
    target: { value: confirmPassword },
  });
}

describe('ResetPasswordForm', () => {
  beforeEach(() => {
    mockConfirmPasswordReset.mockReset();
    login.mockReset();
    toast.mockReset();
  });

  it('renders the same invalid-link panel when the URL carries no email or code', () => {
    render(<ResetPasswordForm email={null} code={null} />);

    expect(screen.getByText(/this link no longer works/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });

  it('strips email and code from the URL once the link has been read', () => {
    const replaceState = jest.spyOn(window.history, 'replaceState');
    render(<ResetPasswordForm email="user@example.com" code="abc123" />);

    expect(replaceState).toHaveBeenCalledWith(null, '', window.location.pathname);
    replaceState.mockRestore();
  });

  it('catches a password/confirm mismatch client-side, without calling the server', () => {
    render(<ResetPasswordForm email="user@example.com" code="abc123" />);

    fillPasswords(VALID_PASSWORD, 'somethingElse1!');
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
    expect(mockConfirmPasswordReset).not.toHaveBeenCalled();
  });

  it('submits email, code, and the new password on a valid confirm', async () => {
    mockConfirmPasswordReset.mockResolvedValue(undefined);
    login.mockResolvedValue(undefined);
    render(<ResetPasswordForm email="user@example.com" code="abc123" />);

    fillPasswords(VALID_PASSWORD, VALID_PASSWORD);
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    await waitFor(() =>
      expect(mockConfirmPasswordReset).toHaveBeenCalledWith({
        email: 'user@example.com',
        code: 'abc123',
        newPassword: VALID_PASSWORD,
      }),
    );
    expect(await screen.findByText(/password reset/i)).toBeInTheDocument();
  });

  it('reports an invalid/expired/unknown code with the same generic panel', async () => {
    mockConfirmPasswordReset.mockRejectedValue(new PasswordResetError('invalid'));
    render(<ResetPasswordForm email="user@example.com" code="abc123" />);

    fillPasswords(VALID_PASSWORD, VALID_PASSWORD);
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(await screen.findByText(/this link no longer works/i)).toBeInTheDocument();
  });
});
