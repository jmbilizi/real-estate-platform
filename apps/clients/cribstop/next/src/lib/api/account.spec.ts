/** @jest-environment node */
import {
  CodesUnavailableError,
  identifyEmail,
  resendSignupCode,
  UndeliverableEmailError,
} from './account';

const mockedFetch = jest.fn();

beforeEach(() => {
  mockedFetch.mockReset();
  global.fetch = mockedFetch as unknown as typeof fetch;
});

const answer = (body: unknown, status = 200) =>
  mockedFetch.mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe('identifyEmail (#813)', () => {
  it('reads a sent answer as sent', async () => {
    answer({ next: 'code', sent: true, resendAfterSeconds: 60, expiresInSeconds: 600 });

    await expect(identifyEmail('a@example.com')).resolves.toEqual({
      next: 'code',
      resendAfterSeconds: 60,
      expiresInSeconds: 600,
    });
  });

  it('carries the reason when nothing was sent', async () => {
    answer({ next: 'code', sent: false, reason: 'hourly_cap', resendAfterSeconds: 900 });

    await expect(identifyEmail('a@example.com')).resolves.toMatchObject({
      notSentReason: 'hourly_cap',
      resendAfterSeconds: 900,
    });
  });

  it('never reads sent: false as sent, even with an unknown reason', async () => {
    answer({ next: 'code', sent: false, reason: 'something_new' });

    await expect(identifyEmail('a@example.com')).resolves.toMatchObject({
      notSentReason: 'cooldown',
    });
  });

  it('throws UndeliverableEmailError for a 422 undeliverable', async () => {
    answer({ error: 'undeliverable' }, 422);

    await expect(identifyEmail('a@example.com')).rejects.toBeInstanceOf(UndeliverableEmailError);
  });

  it.each([500, 502, 503, 504])('throws CodesUnavailableError for a %i', async (status) => {
    answer({}, status);

    await expect(identifyEmail('a@example.com')).rejects.toBeInstanceOf(CodesUnavailableError);
  });
});

describe('resendSignupCode (#813)', () => {
  it('carries the reason when the resend queued nothing', async () => {
    answer({ sent: false, reason: 'pending', resendAfterSeconds: 60, expiresInSeconds: 600 });

    await expect(resendSignupCode('a@example.com')).resolves.toMatchObject({
      notSentReason: 'pending',
    });
  });
});
