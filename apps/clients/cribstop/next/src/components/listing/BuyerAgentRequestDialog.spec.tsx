import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BuyerAgentRequestDialog from './BuyerAgentRequestDialog';
import { InquiryError, submitInquiry } from '@/lib/api/inquiries';

let mockUser: Record<string, string> | null = null;
jest.mock('@/lib/context', () => ({ useApp: () => ({ user: mockUser }) }));
jest.mock('@/lib/api/inquiries', () => {
  const actual = jest.requireActual('@/lib/api/inquiries');
  return { ...actual, submitInquiry: jest.fn() };
});
const mockSubmit = submitInquiry as jest.Mock;

beforeEach(() => {
  mockUser = null;
  mockSubmit.mockReset();
});

function open(kind: 'tour_request' | 'message' = 'tour_request', onClose = jest.fn()) {
  render(<BuyerAgentRequestDialog listingId="L1" kind={kind} onClose={onClose} />);
  return onClose;
}

describe('BuyerAgentRequestDialog (#132)', () => {
  it('submits a signed-out tour request with no account', async () => {
    mockSubmit.mockResolvedValue(undefined);
    const user = userEvent.setup();
    open();
    await user.type(screen.getByLabelText('Name'), 'Sam Buyer');
    await user.type(screen.getByLabelText('Email'), 'sam@example.com');
    await user.click(screen.getByRole('button', { name: 'Send Tour Request' }));

    expect(mockSubmit).toHaveBeenCalledWith('L1', {
      kind: 'tour_request',
      name: 'Sam Buyer',
      email: 'sam@example.com',
    });
    expect(await screen.findByText('We have your request')).toBeInTheDocument();
    expect(screen.getByRole('status').textContent).not.toMatch(
      /confirmed|booked|scheduled|within/i,
    );
  });

  it('prefills a signed-in user and keeps the fields editable', async () => {
    mockUser = { name: 'Pat Lee', firstName: 'Pat', lastName: 'Lee', email: 'pat@example.com' };
    mockSubmit.mockResolvedValue(undefined);
    const user = userEvent.setup();
    open('message');
    expect(screen.getByLabelText('Name')).toHaveValue('Pat Lee');
    expect(screen.getByLabelText('Email')).toHaveValue('pat@example.com');
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Patricia Lee');
    await user.type(screen.getByLabelText('Message'), 'Is this still available?');
    await user.click(screen.getByRole('button', { name: 'Send Message' }));
    expect(mockSubmit).toHaveBeenCalledWith('L1', {
      kind: 'message',
      name: 'Patricia Lee',
      email: 'pat@example.com',
      message: 'Is this still available?',
    });
  });

  it('shows field errors tied to their inputs and sends nothing', async () => {
    const user = userEvent.setup();
    open('message');
    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Send Message' }));
    expect(mockSubmit).not.toHaveBeenCalled();
    const name = screen.getByLabelText('Name');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription('Enter your name.');
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription(
      'Enter a valid email address.',
    );
    expect(screen.getByLabelText('Message')).toHaveAccessibleDescription('Write a message.');
  });

  it('keeps the form after a network failure and retries without a double send', async () => {
    mockSubmit.mockRejectedValueOnce(new InquiryError('retryable'));
    let resolveSecond: () => void = () => undefined;
    mockSubmit.mockImplementationOnce(() => new Promise<void>((r) => (resolveSecond = r)));
    const user = userEvent.setup();
    open();
    await user.type(screen.getByLabelText('Name'), 'Sam');
    await user.type(screen.getByLabelText('Email'), 'sam@example.com');
    await user.click(screen.getByRole('button', { name: 'Send Tour Request' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('could not send');
    expect(screen.getByLabelText('Name')).toHaveValue('Sam');
    await user.click(screen.getByRole('button', { name: 'Try Again' }));
    // The button is disabled while the retry is in flight, so a second click sends nothing.
    await user.click(screen.getByRole('button', { name: 'Sending…' }));
    expect(mockSubmit).toHaveBeenCalledTimes(2);
    resolveSecond();
    await waitFor(() => expect(screen.getByText('We have your request')).toBeInTheDocument());
  });

  it('closes the form for a listing that is no longer available', async () => {
    mockSubmit.mockRejectedValue(new InquiryError('unavailable'));
    const user = userEvent.setup();
    open();
    await user.type(screen.getByLabelText('Name'), 'Sam');
    await user.type(screen.getByLabelText('Email'), 'sam@example.com');
    await user.click(screen.getByRole('button', { name: 'Send Tour Request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no longer available');
    expect(screen.queryByRole('button', { name: 'Try Again' })).toBeNull();
  });

  it('names Cribstop and the broker, not the listing agent, and has no protected-class field', () => {
    open();
    const dialog = screen.getByRole('dialog', { name: 'Request a Tour' });
    expect(dialog.textContent).toContain('Cribstop, brokered by Real Broker, LLC');
    expect(dialog.textContent).toContain('does not contact the listing agent');
    expect(dialog.textContent).toContain('not a booking');
    expect(dialog.textContent).not.toMatch(/rebate|commission|incentive/i);
    const labels = Array.from(dialog.querySelectorAll('label')).map((l) => l.textContent);
    expect(labels).toEqual(['Name', 'Email', 'Phone (optional)', 'Note (optional)']);
    expect(dialog.querySelectorAll('input[type=checkbox],select,input[type=radio]')).toHaveLength(
      0,
    );
  });

  it('closes on Escape and traps Tab inside the dialog', async () => {
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
