import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ConfirmEmailPanel from './ConfirmEmailPanel';
import { confirmEmail, resendConfirmationEmail } from '@/lib/api/account';

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

const toast = jest.fn();
jest.mock('@/lib/useToast', () => ({ useToast: () => ({ toast }) }));

jest.mock('@/lib/api/account', () => ({
  ...jest.requireActual('@/lib/api/account'),
  confirmEmail: jest.fn(),
  resendConfirmationEmail: jest.fn(),
}));

const mockConfirmEmail = confirmEmail as jest.MockedFunction<typeof confirmEmail>;
const mockResendConfirmationEmail = resendConfirmationEmail as jest.MockedFunction<
  typeof resendConfirmationEmail
>;

describe('ConfirmEmailPanel', () => {
  beforeEach(() => {
    push.mockReset();
    toast.mockReset();
    mockConfirmEmail.mockReset();
    mockResendConfirmationEmail.mockReset();
  });

  it('renders the invalid panel with no server call when the URL carries no userId or code', () => {
    render(<ConfirmEmailPanel userId={null} code={null} />);

    expect(screen.getByText(/this link is no longer valid/i)).toBeInTheDocument();
    expect(mockConfirmEmail).not.toHaveBeenCalled();
  });

  it('confirms and routes onward, not dead-ending on a bare success message', async () => {
    mockConfirmEmail.mockResolvedValue('confirmed');
    render(<ConfirmEmailPanel userId="user-1" code="abc123" />);

    expect(await screen.findByText('Email confirmed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to sign in' }));

    expect(push).toHaveBeenCalledWith('/?modal=login');
  });

  it('treats an already-confirmed link as success, not an error', async () => {
    mockConfirmEmail.mockResolvedValue('confirmed');
    render(<ConfirmEmailPanel userId="user-1" code="already-used" />);

    expect(await screen.findByText('Email confirmed')).toBeInTheDocument();
  });

  it('reports expired, used, tampered and unknown links with the same generic panel', async () => {
    mockConfirmEmail.mockResolvedValue('invalid');
    render(<ConfirmEmailPanel userId="user-1" code="bad" />);

    // The server does not say which case applied (#147); the panel does not distinguish it
    // either — same heading and copy however the account was resolved.
    expect(await screen.findByText(/this link is no longer valid/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
  });

  it('strips userId and code from the URL once the link has been read', () => {
    const replaceState = jest.spyOn(window.history, 'replaceState');
    mockConfirmEmail.mockResolvedValue('confirmed');
    render(<ConfirmEmailPanel userId="user-1" code="abc123" />);

    expect(replaceState).toHaveBeenCalledWith(null, '', window.location.pathname);
    replaceState.mockRestore();
  });

  it('requests a new link by email from the invalid-link panel', async () => {
    mockConfirmEmail.mockResolvedValue('invalid');
    mockResendConfirmationEmail.mockResolvedValue(undefined);
    render(<ConfirmEmailPanel userId="user-1" code="bad" />);
    await screen.findByText(/this link is no longer valid/i);

    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Request a new link' }));

    await waitFor(() =>
      expect(mockResendConfirmationEmail).toHaveBeenCalledWith('user@example.com'),
    );
  });
});
