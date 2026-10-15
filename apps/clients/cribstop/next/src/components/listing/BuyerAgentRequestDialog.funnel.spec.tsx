import { StrictMode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BuyerAgentRequestDialog from './BuyerAgentRequestDialog';
import { InquiryError, submitInquiry } from '@/lib/api/inquiries';
import { trackEvent } from '@/lib/analytics';

jest.mock('@/lib/analytics', () => ({ trackEvent: jest.fn() }));
jest.mock('@/lib/context', () => ({
  useApp: () => ({ user: { name: 'Pat', email: 'pat@example.com' } }),
}));
jest.mock('@/lib/api/inquiries', () => {
  const actual = jest.requireActual('@/lib/api/inquiries');
  return { ...actual, submitInquiry: jest.fn() };
});
jest.mock('@/components/AuthForm', () => ({ __esModule: true, default: () => null }));

const mockSubmit = submitInquiry as jest.Mock;
const mockTrack = trackEvent as jest.Mock;
const names = () => mockTrack.mock.calls.map((c) => c[0]);

beforeEach(() => {
  mockSubmit.mockReset();
  mockTrack.mockReset();
});

function open(kind: 'tour_request' | 'message' = 'tour_request') {
  return render(
    <StrictMode>
      <BuyerAgentRequestDialog listingId="L1" kind={kind} onClose={jest.fn()} />
    </StrictMode>,
  );
}

describe('BuyerAgentRequestDialog funnel events (#827)', () => {
  it('records lead_open once, also under StrictMode and a re-render', () => {
    const view = open('tour_request');
    view.rerender(
      <StrictMode>
        <BuyerAgentRequestDialog listingId="L1" kind="tour_request" onClose={jest.fn()} />
      </StrictMode>,
    );
    expect(names()).toEqual(['lead_open']);
    expect(mockTrack).toHaveBeenCalledWith('lead_open', {
      surface: 'detail',
      listingId: 'L1',
      props: { form_type: 'tour' },
    });
  });

  it('records lead_start once on the first edit, not on later edits', async () => {
    const user = userEvent.setup();
    open('message');
    await user.type(screen.getByLabelText('Message'), 'Hello there');
    expect(names().filter((n) => n === 'lead_start')).toHaveLength(1);
    expect(mockTrack).toHaveBeenCalledWith('lead_start', {
      surface: 'detail',
      listingId: 'L1',
      props: { form_type: 'info' },
    });
  });

  it('records lead_error with the validation code once per failed submit', async () => {
    const user = userEvent.setup();
    open('message');
    await user.click(screen.getByRole('button', { name: 'Send Message' }));
    expect(mockSubmit).not.toHaveBeenCalled();
    const errors = mockTrack.mock.calls.filter((c) => c[0] === 'lead_error');
    expect(errors).toHaveLength(1);
    expect(errors[0][1].props).toEqual({ form_type: 'info', error_code: 'validation' });
  });

  it('records lead_error with a fixed code when the service fails, and no text', async () => {
    mockSubmit.mockRejectedValue(new InquiryError('rate_limited'));
    const user = userEvent.setup();
    open('tour_request');
    await user.type(screen.getByLabelText('Note (optional)'), 'jane@example.com 202-555-0142');
    await user.click(screen.getByRole('button', { name: 'Send Tour Request' }));
    const errors = mockTrack.mock.calls.filter((c) => c[0] === 'lead_error');
    expect(errors).toHaveLength(1);
    expect(errors[0][1].props).toEqual({ form_type: 'tour', error_code: 'rate_limited' });
    expect(JSON.stringify(mockTrack.mock.calls)).not.toMatch(/jane@|202-555/);
  });

  it('maps an unknown failure to the network code', async () => {
    mockSubmit.mockRejectedValue(new InquiryError('retryable'));
    const user = userEvent.setup();
    open('tour_request');
    await user.click(screen.getByRole('button', { name: 'Send Tour Request' }));
    const errors = mockTrack.mock.calls.filter((c) => c[0] === 'lead_error');
    expect(errors[0][1].props.error_code).toBe('network');
  });
});
