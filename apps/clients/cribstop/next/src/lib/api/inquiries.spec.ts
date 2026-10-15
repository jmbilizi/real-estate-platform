import { InquiryError, submitInquiry } from './inquiries';
import { trackEvent } from '@/lib/analytics';

jest.mock('@/lib/analytics', () => ({ trackEvent: jest.fn() }));
const mockTrack = trackEvent as jest.Mock;

const input = {
  kind: 'message' as const,
  consentTextVersion: 'v1' as const,
  consentChannels: ['email' as const],
};

function respond(status: number) {
  global.fetch = jest.fn().mockResolvedValue({ ok: status < 400, status }) as never;
}

describe('submitInquiry', () => {
  it.each([
    [401, 'unauthorized'],
    [403, 'unconfirmed'],
    [404, 'unavailable'],
    [400, 'invalid'],
    [429, 'rate_limited'],
    [500, 'retryable'],
  ])('maps %i to %s', async (status, failure) => {
    respond(status);
    await expect(submitInquiry('L1', input)).rejects.toMatchObject({
      name: 'InquiryError',
      failure,
    });
  });

  it('resolves on success', async () => {
    respond(201);
    await expect(submitInquiry('L1', input)).resolves.toBeUndefined();
  });

  it('maps a network error to retryable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as never;
    await expect(submitInquiry('L1', input)).rejects.toBeInstanceOf(InquiryError);
  });
});

describe('submitInquiry funnel event (#827)', () => {
  beforeEach(() => mockTrack.mockReset());

  it('records lead_submit once on success, with the form type and no contact data', async () => {
    respond(201);
    await submitInquiry('L1', {
      ...input,
      kind: 'tour_request',
      phone: '2025550142',
      message: 'hi',
    });
    expect(mockTrack).toHaveBeenCalledTimes(1);
    expect(mockTrack).toHaveBeenCalledWith('lead_submit', {
      surface: 'detail',
      listingId: 'L1',
      props: { form_type: 'tour' },
    });
  });

  it('records no lead_submit on failure', async () => {
    respond(500);
    await expect(submitInquiry('L1', input)).rejects.toBeInstanceOf(InquiryError);
    expect(mockTrack).not.toHaveBeenCalled();
  });
});
