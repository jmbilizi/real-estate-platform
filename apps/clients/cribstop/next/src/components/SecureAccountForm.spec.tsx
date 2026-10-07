import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SecureAccountForm from './SecureAccountForm';
import { secureAccount } from '@/lib/api/account';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
jest.mock('@/lib/api/account', () => ({ secureAccount: jest.fn() }));

const mockSecure = secureAccount as jest.MockedFunction<typeof secureAccount>;

describe('SecureAccountForm', () => {
  beforeEach(() => window.sessionStorage.clear());
  afterEach(() => jest.resetAllMocks());

  it('does not call the API on load and removes the token from the address bar', () => {
    window.history.replaceState(null, '', '/secure-account?token=abc');
    render(<SecureAccountForm token="abc" />);

    expect(screen.getByRole('heading', { name: 'Secure your account' })).toBeInTheDocument();
    expect(mockSecure).not.toHaveBeenCalled();
    expect(window.location.search).toBe('');
  });

  it('sends the token once when the user presses the button', async () => {
    mockSecure.mockResolvedValue({ status: 'secured', emailRestored: true });
    render(<SecureAccountForm token="abc" />);

    fireEvent.click(screen.getByRole('button', { name: /secure my account/i }));

    expect(
      await screen.findByRole('heading', { name: 'Your account is secure' }),
    ).toBeInTheDocument();
    expect(mockSecure).toHaveBeenCalledTimes(1);
    expect(mockSecure).toHaveBeenCalledWith('abc');
    expect(screen.getByText('We put your previous email address back.')).toBeInTheDocument();
  });

  it('does not claim a restore when the email stayed', async () => {
    mockSecure.mockResolvedValue({ status: 'secured', emailRestored: false });
    render(<SecureAccountForm token="abc" />);

    fireEvent.click(screen.getByRole('button', { name: /secure my account/i }));

    await screen.findByRole('heading', { name: 'Your account is secure' });
    expect(screen.queryByText(/previous email address/i)).not.toBeInTheDocument();
  });

  it('opens the forgot-password flow from the next step', async () => {
    mockSecure.mockResolvedValue({ status: 'secured', emailRestored: false });
    render(<SecureAccountForm token="abc" />);
    fireEvent.click(screen.getByRole('button', { name: /secure my account/i }));

    fireEvent.click(await screen.findByRole('button', { name: 'Reset your password' }));

    expect(push).toHaveBeenCalledWith('/?modal=login&mode=forgot');
  });

  it('shows one neutral message for a bad token', async () => {
    mockSecure.mockResolvedValue({ status: 'invalid' });
    render(<SecureAccountForm token="abc" />);

    fireEvent.click(screen.getByRole('button', { name: /secure my account/i }));

    expect(
      await screen.findByRole('heading', { name: 'This link no longer works' }),
    ).toBeInTheDocument();
  });

  it('shows the neutral message when the link has no token', () => {
    render(<SecureAccountForm token={null} />);

    expect(screen.getByRole('heading', { name: 'This link no longer works' })).toBeInTheDocument();
    expect(mockSecure).not.toHaveBeenCalled();
  });

  it('keeps an unused token across a reload of the stripped URL', async () => {
    mockSecure.mockResolvedValue({ status: 'secured', emailRestored: false });
    const first = render(<SecureAccountForm token="abc" />);
    first.unmount();

    render(<SecureAccountForm token={null} />);
    fireEvent.click(await screen.findByRole('button', { name: /secure my account/i }));

    await screen.findByRole('heading', { name: 'Your account is secure' });
    expect(mockSecure).toHaveBeenCalledWith('abc');
    expect(window.sessionStorage.getItem('secure-account-token')).toBeNull();
  });

  it('lets the user try again after a failed call', async () => {
    mockSecure.mockResolvedValueOnce({ status: 'failed' });
    render(<SecureAccountForm token="abc" />);
    fireEvent.click(screen.getByRole('button', { name: /secure my account/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong'),
    );
    expect(screen.getByRole('button', { name: /secure my account/i })).toBeEnabled();
  });
});
