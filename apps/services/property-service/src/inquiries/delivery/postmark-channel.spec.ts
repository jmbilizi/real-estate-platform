import { DeliveryError, type DeliveryMessage } from './channel';
import type { SendConfig } from './config';
import { createPostmarkChannel } from './postmark-channel';

const CONFIG: SendConfig = {
  token: 'sandbox-token',
  intakeAddress: 'intake@cribstop.example',
  fromAddress: 'no-reply@cribstop.example',
  messageStream: 'outbound',
  apiBaseUrl: 'https://postmark.test/',
  requestTimeoutMs: 1000,
};

const MESSAGE: DeliveryMessage = {
  to: 'intake@cribstop.example',
  from: 'no-reply@cribstop.example',
  replyTo: 'jane@example.com',
  subject: 'Subject',
  textBody: 'Body',
  tag: 'buyer-agent-intake',
  metadata: { inquiryId: 'inq-1' },
};

function respond(status: number, body: unknown): jest.Mock {
  return jest.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
}

describe('createPostmarkChannel', () => {
  it('posts the documented request shape and returns the MessageID', async () => {
    const fetchMock = respond(200, { ErrorCode: 0, Message: 'OK', MessageID: 'pm-123' });
    const receipt = await createPostmarkChannel(CONFIG, fetchMock).send(MESSAGE);

    expect(receipt.messageId).toBe('pm-123');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://postmark.test/email');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-Postmark-Server-Token']).toBe(
      'sandbox-token',
    );
    expect(JSON.parse(init.body as string)).toEqual({
      From: 'no-reply@cribstop.example',
      To: 'intake@cribstop.example',
      ReplyTo: 'jane@example.com',
      Subject: 'Subject',
      TextBody: 'Body',
      MessageStream: 'outbound',
      Tag: 'buyer-agent-intake',
      Metadata: { inquiryId: 'inq-1' },
    });
  });

  it.each([
    [500, true],
    [429, true],
    [401, true],
    [422, false],
    [406, false],
  ])('classifies HTTP %i as retryable=%s', async (status, retryable) => {
    const channel = createPostmarkChannel(
      CONFIG,
      respond(status, { ErrorCode: 406, Message: 'No' }),
    );
    const error = await channel.send(MESSAGE).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DeliveryError);
    expect((error as DeliveryError).retryable).toBe(retryable);
  });

  it('treats a network failure as retryable and never leaks the token', async () => {
    const fetchMock = jest.fn(() => Promise.reject(new Error('connect ECONNREFUSED')));
    const error = (await createPostmarkChannel(CONFIG, fetchMock)
      .send(MESSAGE)
      .catch((e: unknown) => e)) as DeliveryError;
    expect(error.retryable).toBe(true);
    expect(error.message).not.toContain('sandbox-token');
  });

  it('refuses to record a delivery without a MessageID', async () => {
    const error = (await createPostmarkChannel(CONFIG, respond(200, { ErrorCode: 0 }))
      .send(MESSAGE)
      .catch((e: unknown) => e)) as DeliveryError;
    expect(error).toBeInstanceOf(DeliveryError);
    expect(error.retryable).toBe(true);
  });
});
