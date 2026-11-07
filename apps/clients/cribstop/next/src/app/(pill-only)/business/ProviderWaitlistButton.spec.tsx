import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProviderWaitlistButton from './ProviderWaitlistButton';

const mockUseApp = jest.fn();
const mockOpenAuthModal = jest.fn();
const mockToast = jest.fn();
const mockGet = jest.fn();
const mockJoin = jest.fn();
const mockLeave = jest.fn();

jest.mock('@/lib/context', () => ({ useApp: () => mockUseApp() }));
jest.mock('@/lib/auth-modal', () => ({
  openAuthModal: (...a: unknown[]) => mockOpenAuthModal(...a),
}));
jest.mock('@/lib/useToast', () => ({ useToast: () => ({ toast: mockToast }) }));
jest.mock('@/lib/api/waitlist', () => ({
  getWaitlistInterests: () => mockGet(),
  joinWaitlist: (k: string) => mockJoin(k),
  leaveWaitlist: (k: string) => mockLeave(k),
}));

const signedOut = { user: null, sessionLoading: false };
const signedIn = { user: { id: 'u1' }, sessionLoading: false };

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue([]);
  mockJoin.mockResolvedValue(undefined);
  mockLeave.mockResolvedValue(undefined);
});

const button = () => screen.getByRole('button');

describe('ProviderWaitlistButton', () => {
  it('opens the login modal for a signed-out visitor and does not join', async () => {
    mockUseApp.mockReturnValue(signedOut);
    render(<ProviderWaitlistButton />);
    await waitFor(() => expect(button()).toBeEnabled());
    expect(button()).toHaveTextContent('Join the provider waitlist');
    fireEvent.click(button());
    expect(mockOpenAuthModal).toHaveBeenCalledWith('login');
    expect(mockJoin).not.toHaveBeenCalled();
  });

  it('joins in one tap for a signed-in visitor with the provider kind', async () => {
    mockUseApp.mockReturnValue(signedIn);
    render(<ProviderWaitlistButton />);
    await waitFor(() => expect(button()).toBeEnabled());
    fireEvent.click(button());
    await waitFor(() => expect(mockJoin).toHaveBeenCalledTimes(1));
    expect(mockJoin).toHaveBeenCalledWith('services-provider');
    expect(mockOpenAuthModal).not.toHaveBeenCalled();
    expect(button()).toHaveTextContent("You're on the list");
  });

  it('shows the joined state and lets the visitor leave', async () => {
    mockUseApp.mockReturnValue(signedIn);
    mockGet.mockResolvedValue(['services-provider']);
    render(<ProviderWaitlistButton />);
    await waitFor(() => expect(button()).toHaveTextContent("You're on the list"));
    fireEvent.click(button());
    await waitFor(() => expect(mockLeave).toHaveBeenCalledWith('services-provider'));
    await waitFor(() => expect(button()).toHaveTextContent('Join the provider waitlist'));
  });

  it('reverts and shows an error when the join fails', async () => {
    mockUseApp.mockReturnValue(signedIn);
    mockJoin.mockRejectedValue(new Error('boom'));
    render(<ProviderWaitlistButton />);
    await waitFor(() => expect(button()).toBeEnabled());
    fireEvent.click(button());
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('could not'), 'error'),
    );
    expect(button()).toHaveTextContent('Join the provider waitlist');
  });
});
