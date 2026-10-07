import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BuyerAgentRequestDialog from './BuyerAgentRequestDialog';
import { CONSENT_TEXTS } from '@cribstop/property-contracts';
import { InquiryError, submitInquiry } from '@/lib/api/inquiries';

let mockUser: Record<string, string> | null = null;
let mockSignInEmail = 'pat@example.com';
let mockRerender: () => void = () => undefined;
jest.mock('@/lib/context', () => ({ useApp: () => ({ user: mockUser }) }));
jest.mock('@/lib/api/inquiries', () => {
  const actual = jest.requireActual('@/lib/api/inquiries');
  return { ...actual, submitInquiry: jest.fn() };
});
// The real flow is covered by AuthForm.spec. The stub signs the buyer in.
jest.mock('@/components/AuthForm', () => ({
  __esModule: true,
  default: ({ onSuccess }: { onSuccess?: () => void }) => (
    <div data-testid="auth-form">
      <button
        type="button"
        onClick={() => {
          mockUser = { name: mockSignInEmail, email: mockSignInEmail };
          onSuccess?.();
        }}
      >
        Finish sign-in
      </button>
    </div>
  ),
}));
const mockSubmit = submitInquiry as jest.Mock;
const CONSENT = { consentTextVersion: 'v1', consentChannels: ['email'] };
const PAT = { name: 'Pat Lee', firstName: 'Pat', lastName: 'Lee', email: 'pat@example.com' };

beforeEach(() => {
  mockUser = null;
  mockSignInEmail = 'pat@example.com';
  mockSubmit.mockReset();
});

function open(kind: 'tour_request' | 'message' = 'tour_request', onClose = jest.fn()) {
  const ui = <BuyerAgentRequestDialog listingId="L1" kind={kind} onClose={onClose} />;
  const view = render(ui);
  mockRerender = () => view.rerender(ui);
  return onClose;
}

describe('BuyerAgentRequestDialog (#132, #688)', () => {
  it('shows the account name and email read-only, with no editable name or email', () => {
    mockUser = PAT;
    open('message');
    const contact = screen.getByTestId('account-contact');
    expect(contact).toHaveTextContent('From your account');
    expect(contact).toHaveTextContent('Pat Lee');
    expect(contact).toHaveTextContent('pat@example.com');
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(screen.queryByLabelText('Email')).toBeNull();
  });

  it('sends the account name and email with the unchanged payload shape', async () => {
    mockUser = PAT;
    mockSubmit.mockResolvedValue(undefined);
    const user = userEvent.setup();
    open('message');
    await user.type(screen.getByLabelText('Message'), 'Is this still available?');
    await user.click(screen.getByRole('button', { name: 'Send Message' }));
    expect(mockSubmit).toHaveBeenCalledWith('L1', {
      kind: 'message',
      name: 'Pat Lee',
      email: 'pat@example.com',
      message: 'Is this still available?',
      ...CONSENT,
    });
    expect(await screen.findByText('We have your request')).toBeInTheDocument();
    expect(screen.getByRole('status').textContent).not.toMatch(
      /confirmed|booked|scheduled|within|email you/i,
    );
  });

  it('shows the email once for a new account whose name is its email', () => {
    mockUser = { name: 'new@example.com', email: 'new@example.com' };
    open();
    expect(screen.getByTestId('account-contact').textContent).toBe(
      'From your accountnew@example.com',
    );
  });

  it('opens the sign-in flow for a signed-out buyer, sends nothing, and keeps the input', async () => {
    const user = userEvent.setup();
    open('message');
    expect(screen.queryByTestId('consent-disclosure')).toBeNull();
    await user.type(screen.getByLabelText('Message'), 'Is this still available?');
    await user.type(screen.getByLabelText('Phone (optional)'), '(202) 555-0100');
    await user.click(screen.getByRole('button', { name: 'Sign in to continue' }));
    expect(screen.getByTestId('auth-form')).toBeInTheDocument();
    expect(mockSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Back to your request' }));
    expect(screen.queryByTestId('auth-form')).toBeNull();
    expect(screen.getByLabelText('Message')).toHaveValue('Is this still available?');
    expect(screen.getByLabelText('Phone (optional)')).toHaveValue('(202) 555-0100');
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('returns Escape from the sign-in step to the form instead of closing the dialog', async () => {
    const user = userEvent.setup();
    const onClose = open('message');
    await user.type(screen.getByLabelText('Message'), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Sign in to continue' }));
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Message')).toHaveValue('Hello');
  });

  it('returns to the form with the account email locked after sign-in, then sends', async () => {
    mockSubmit.mockResolvedValue(undefined);
    const user = userEvent.setup();
    open('message');
    await user.type(screen.getByLabelText('Message'), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Sign in to continue' }));
    await user.click(screen.getByRole('button', { name: 'Finish sign-in' }));
    act(() => mockRerender());

    expect(screen.getByTestId('account-contact')).toHaveTextContent('pat@example.com');
    expect(screen.getByLabelText('Message')).toHaveValue('Hello');
    expect(mockSubmit).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Send Message' }));
    expect(mockSubmit).toHaveBeenCalledWith(
      'L1',
      expect.objectContaining({ email: 'pat@example.com', message: 'Hello' }),
    );
  });

  it('shows sign-in on a 401 and retries once after sign-in, never a raw error', async () => {
    mockUser = PAT;
    mockSubmit.mockRejectedValueOnce(new InquiryError('unauthorized'));
    mockSubmit.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    open('message');
    await user.type(screen.getByLabelText('Message'), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send Message' }));
    expect(await screen.findByTestId('auth-form')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Finish sign-in' }));
    act(() => mockRerender());
    expect(await screen.findByText('We have your request')).toBeInTheDocument();
    expect(mockSubmit).toHaveBeenCalledTimes(2);
    expect(mockSubmit).toHaveBeenLastCalledWith(
      'L1',
      expect.objectContaining({ message: 'Hello', email: 'pat@example.com' }),
    );
  });

  it('does not loop when the retry meets a second 401', async () => {
    mockUser = PAT;
    mockSubmit.mockRejectedValue(new InquiryError('unauthorized'));
    const user = userEvent.setup();
    open('message');
    await user.type(screen.getByLabelText('Message'), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send Message' }));
    await user.click(await screen.findByRole('button', { name: 'Finish sign-in' }));
    act(() => mockRerender());
    expect(await screen.findByRole('alert')).toHaveTextContent('session ended');
    expect(mockSubmit).toHaveBeenCalledTimes(2);
  });

  it('does not send after a 401 when a different account signs in, and shows that account', async () => {
    mockUser = PAT;
    mockSubmit.mockRejectedValueOnce(new InquiryError('unauthorized'));
    mockSignInEmail = 'other@example.com';
    const user = userEvent.setup();
    open('message');
    await user.type(screen.getByLabelText('Message'), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send Message' }));
    await user.click(await screen.findByRole('button', { name: 'Finish sign-in' }));
    act(() => mockRerender());
    expect(await screen.findByTestId('account-contact')).toHaveTextContent('other@example.com');
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Message')).toHaveValue('Hello');
  });

  it('opens sign-in again when a later submit meets a new 401 after a retry', async () => {
    mockUser = PAT;
    mockSubmit.mockRejectedValue(new InquiryError('unauthorized'));
    const user = userEvent.setup();
    open('message');
    await user.type(screen.getByLabelText('Message'), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send Message' }));
    await user.click(await screen.findByRole('button', { name: 'Finish sign-in' }));
    act(() => mockRerender());
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(await screen.findByTestId('auth-form')).toBeInTheDocument();
  });

  it('sends the phone as +1 digits with phone consent channels', async () => {
    mockUser = PAT;
    mockSubmit.mockResolvedValue(undefined);
    const user = userEvent.setup();
    open();
    await user.type(screen.getByLabelText('Phone (optional)'), '(202) 555-0100');
    await user.click(screen.getByRole('button', { name: 'Send Tour Request' }));
    expect(mockSubmit).toHaveBeenCalledWith(
      'L1',
      expect.objectContaining({
        phone: '+12025550100',
        consentChannels: ['email', 'phone_call', 'phone_text'],
      }),
    );
  });

  it('rejects a phone that is not a US number and sends nothing', async () => {
    mockUser = PAT;
    const user = userEvent.setup();
    open();
    await user.type(screen.getByLabelText('Phone (optional)'), '555-0100');
    await user.click(screen.getByRole('button', { name: 'Send Tour Request' }));
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Phone (optional)')).toHaveAccessibleDescription(
      'Enter a 10-digit US phone number, or leave it blank.',
    );
  });

  it('shows the server-owned consent text beside the submit button, with no checkbox', () => {
    mockUser = PAT;
    open('message');
    const disclosure = screen.getByTestId('consent-disclosure');
    expect(disclosure.textContent).toContain(CONSENT_TEXTS.v1);
    expect(disclosure.textContent).toContain('Real Broker, LLC');
    expect(disclosure.textContent).toContain('Send Message');
    expect(disclosure.nextElementSibling).toBe(
      screen.getByRole('button', { name: 'Send Message' }),
    );
  });

  it('shows a message error tied to its input and sends nothing', async () => {
    mockUser = PAT;
    const user = userEvent.setup();
    open('message');
    await user.click(screen.getByRole('button', { name: 'Send Message' }));
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Message')).toHaveAccessibleDescription('Write a message.');
  });

  it('keeps the form after a network failure and retries without a double send', async () => {
    mockUser = PAT;
    mockSubmit.mockRejectedValueOnce(new InquiryError('retryable'));
    let resolveSecond: () => void = () => undefined;
    mockSubmit.mockImplementationOnce(() => new Promise<void>((r) => (resolveSecond = r)));
    const user = userEvent.setup();
    open();
    await user.type(screen.getByLabelText('Phone (optional)'), '2025550100');
    await user.click(screen.getByRole('button', { name: 'Send Tour Request' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('could not send');
    expect(screen.getByLabelText('Phone (optional)')).toHaveValue('2025550100');
    await user.click(screen.getByRole('button', { name: 'Try Again' }));
    // The button is disabled while the retry is in flight, so a second click sends nothing.
    await user.click(screen.getByRole('button', { name: 'Sending…' }));
    expect(mockSubmit).toHaveBeenCalledTimes(2);
    resolveSecond();
    await waitFor(() => expect(screen.getByText('We have your request')).toBeInTheDocument());
  });

  it('closes the form for a listing that is no longer available', async () => {
    mockUser = PAT;
    mockSubmit.mockRejectedValue(new InquiryError('unavailable'));
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole('button', { name: 'Send Tour Request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no longer available');
    expect(screen.queryByRole('button', { name: 'Try Again' })).toBeNull();
  });

  it('names Cribstop and the broker, not the listing agent, and has no protected-class field', () => {
    mockUser = PAT;
    open();
    const dialog = screen.getByRole('dialog', { name: 'Request a Tour' });
    expect(dialog.textContent).toContain('Cribstop, brokered by Real Broker, LLC');
    expect(dialog.textContent).toContain('does not contact the listing agent');
    expect(dialog.textContent).toContain('not a booking');
    expect(dialog.textContent).not.toMatch(/rebate|commission|incentive/i);
    const labels = Array.from(dialog.querySelectorAll('label')).map((l) => l.textContent);
    expect(labels).toEqual(['Phone (optional)', 'Note (optional)']);
    expect(dialog.querySelectorAll('input[type=checkbox],select,input[type=radio]')).toHaveLength(
      0,
    );
  });

  it('closes on Escape and traps Tab inside the dialog', async () => {
    mockUser = PAT;
    const user = userEvent.setup();
    const onClose = open();
    const close = screen.getByRole('button', { name: 'Close' });
    const submit = screen.getByRole('button', { name: 'Send Tour Request' });
    submit.focus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(submit).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
