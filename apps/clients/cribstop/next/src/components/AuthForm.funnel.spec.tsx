import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AuthForm from './AuthForm';
import {
  CodesUnavailableError,
  identifyEmail,
  RateLimitError,
  SignInFailedError,
  verifySignupCode,
} from '@/lib/api/account';
import { linkAnonToAccount, trackEvent } from '@/lib/analytics';

const login = jest.fn();
const completeSignup = jest.fn();
jest.mock('@/lib/context', () => ({ useApp: () => ({ login, completeSignup }) }));
jest.mock('@/lib/useToast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('@/lib/analytics', () => ({ trackEvent: jest.fn(), linkAnonToAccount: jest.fn() }));
jest.mock('@/lib/api/account', () => ({
  ...jest.requireActual('@/lib/api/account'),
  identifyEmail: jest.fn(),
  verifySignupCode: jest.fn(),
  getPasswordPolicy: jest.fn().mockResolvedValue({
    minLength: 8,
    passphraseLength: 15,
    requiredClasses: ['upper', 'lower', 'digit', 'symbol'],
  }),
}));

const mockIdentify = identifyEmail as jest.Mock;
const mockVerify = verifySignupCode as jest.Mock;
const mockTrack = trackEvent as jest.Mock;
const mockLink = linkAnonToAccount as jest.Mock;
const EMAIL = 'user@example.com';
const PASSWORD = 'a long passphrase here';
const events = () => mockTrack.mock.calls.map((c) => c[0] as string);
const callsOf = (name: string) => mockTrack.mock.calls.filter((c) => c[0] === name);

beforeEach(() => {
  jest.clearAllMocks();
  (jest.requireMock('@/lib/api/account').getPasswordPolicy as jest.Mock).mockResolvedValue({
    minLength: 8,
    passphraseLength: 15,
    requiredClasses: ['upper', 'lower', 'digit', 'symbol'],
  });
});

function renderForm(props: Parameters<typeof AuthForm>[0] = {}) {
  return render(
    <StrictMode>
      <AuthForm {...props} />
    </StrictMode>,
  );
}

function submitEmail() {
  fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: EMAIL } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

async function toCodeStep() {
  mockIdentify.mockResolvedValue({ next: 'code', resendAfterSeconds: 30, expiresInSeconds: 600 });
  submitEmail();
  await screen.findByRole('heading', { name: 'Check your email' });
}

describe('AuthForm funnel events (#827)', () => {
  it('records auth_identify_shown once, also under StrictMode and a re-render', () => {
    const view = renderForm();
    view.rerender(
      <StrictMode>
        <AuthForm />
      </StrictMode>,
    );
    expect(events()).toEqual(['auth_identify_shown']);
    expect(mockTrack.mock.calls[0][1].surface).toBe('auth');
  });

  it('records auth_code_sent once when identify sends a code', async () => {
    renderForm();
    await toCodeStep();
    expect(callsOf('auth_code_sent')).toHaveLength(1);
    expect(callsOf('auth_code_sent')[0][1].props).toEqual({
      method: 'email_code',
      entry_point: 'signup',
    });
  });

  it('records no auth_code_sent when identify sends no code', async () => {
    renderForm();
    mockIdentify.mockResolvedValue({
      next: 'code',
      resendAfterSeconds: 30,
      expiresInSeconds: 0,
      notSentReason: 'pending',
    });
    submitEmail();
    await screen.findByRole('heading', { name: 'Check your email' });
    expect(callsOf('auth_code_sent')).toHaveLength(0);
  });

  it('records one auth_fail with a fixed code when identify fails', async () => {
    renderForm();
    mockIdentify.mockRejectedValue(new RateLimitError(30));
    submitEmail();
    await screen.findByRole('alert');
    expect(callsOf('auth_fail')).toHaveLength(1);
    expect(callsOf('auth_fail')[0][1].props).toEqual({ error_code: 'rate_limited' });
  });

  it('records auth_code_verified once, then one auth_fail for a bad code', async () => {
    renderForm();
    await toCodeStep();
    mockVerify.mockResolvedValueOnce({ ok: false, attemptsLeft: 4 });
    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '111111' } });
    await screen.findByText(/That code did not work/);
    expect(callsOf('auth_fail')).toHaveLength(1);
    expect(callsOf('auth_fail')[0][1].props).toEqual({ error_code: 'code_invalid' });
    expect(callsOf('auth_code_verified')).toHaveLength(0);

    mockVerify.mockResolvedValueOnce({ ok: true, signupProof: 'proof-1' });
    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '222222' } });
    await screen.findByLabelText('Set your password');
    expect(callsOf('auth_code_verified')).toHaveLength(1);
  });

  it('maps a code outage to code_unavailable', async () => {
    renderForm();
    await toCodeStep();
    mockVerify.mockRejectedValueOnce(new CodesUnavailableError());
    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '111111' } });
    await screen.findByRole('alert');
    expect(callsOf('auth_fail')[0][1].props).toEqual({ error_code: 'code_unavailable' });
  });

  it('records auth_signup_done once and links the account once after sign-up', async () => {
    completeSignup.mockResolvedValue({ ok: true, session: { email: EMAIL } });
    renderForm();
    await toCodeStep();
    mockVerify.mockResolvedValue({ ok: true, signupProof: 'proof-1' });
    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '123456' } });
    await screen.findByLabelText('Set your password');
    expect(mockLink).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Set your password'), { target: { value: PASSWORD } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: PASSWORD } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(callsOf('auth_signup_done')).toHaveLength(1));
    expect(callsOf('auth_signup_done')[0][1].props).toEqual({
      method: 'email_code',
      is_new_account: true,
    });
    expect(mockLink).toHaveBeenCalledTimes(1);
  });

  it('records auth_fail password_rejected once for a rejected password, with no link', async () => {
    completeSignup.mockResolvedValue({
      ok: false,
      reason: 'password_rejected',
      errors: ['breached'],
    });
    renderForm();
    await toCodeStep();
    mockVerify.mockResolvedValue({ ok: true, signupProof: 'proof-1' });
    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '123456' } });
    await screen.findByLabelText('Set your password');
    fireEvent.change(screen.getByLabelText('Set your password'), { target: { value: PASSWORD } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: PASSWORD } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await screen.findByRole('alert');
    expect(callsOf('auth_fail')).toHaveLength(1);
    expect(callsOf('auth_fail')[0][1].props).toEqual({ error_code: 'password_rejected' });
    expect(callsOf('auth_signup_done')).toHaveLength(0);
    expect(mockLink).not.toHaveBeenCalled();
  });

  it('links the account once after a password sign-in and records no sign-up event', async () => {
    login.mockResolvedValue(undefined);
    renderForm({ onSuccess: jest.fn() });
    mockIdentify.mockResolvedValue({ next: 'password' });
    submitEmail();
    await screen.findByRole('heading', { name: 'Welcome back' });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'whatever' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(mockLink).toHaveBeenCalledTimes(1));
    expect(callsOf('auth_signup_done')).toHaveLength(0);
    expect(callsOf('auth_fail')).toHaveLength(0);
  });

  it('records one auth_fail and no link for a wrong password', async () => {
    login.mockRejectedValue(new SignInFailedError());
    renderForm();
    mockIdentify.mockResolvedValue({ next: 'password' });
    submitEmail();
    await screen.findByRole('heading', { name: 'Welcome back' });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'whatever' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText('We could not sign you in with that email and password.');
    expect(callsOf('auth_fail')).toHaveLength(1);
    expect(callsOf('auth_fail')[0][1].props).toEqual({
      method: 'password',
      error_code: 'invalid_credentials',
    });
    expect(mockLink).not.toHaveBeenCalled();
  });

  it('puts no email, phone or name in any event', async () => {
    renderForm();
    await toCodeStep();
    expect(JSON.stringify(mockTrack.mock.calls)).not.toContain(EMAIL);
    expect(JSON.stringify(mockTrack.mock.calls)).not.toContain('user');
  });
});
