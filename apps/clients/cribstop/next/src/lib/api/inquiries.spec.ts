import { InquiryError, submitInquiry } from './inquiries';

const input = {
  kind: 'message' as const,
  name: 'Pat',
  email: 'pat@example.com',
  consentTextVersion: 'v1' as const,
  consentChannels: ['email' as const],
};

function respond(status: number) {
  global.fetch = jest.fn().mockResolvedValue({ ok: status < 400, status }) as never;
}

describe('submitInquiry', () => {
  it.each([
    [401, 'unauthorized'],
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
