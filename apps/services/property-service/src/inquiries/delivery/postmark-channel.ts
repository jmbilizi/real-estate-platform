import { type DeliveryChannel, DeliveryError, type DeliveryMessage } from './channel';
import type { SendConfig } from './config';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const MAX_ERROR_LENGTH = 300;

function clip(text: string): string {
  return text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH)}...` : text;
}

/**
 * Postmark `POST /email`. A sandbox token accepts the call and discards the mail, so a green send
 * outside prod proves the request shape and the recorded MessageID. It does not prove delivery.
 *
 * Retry rule: network errors, timeouts, 429 and 5xx retry. 401 and 403 retry too, because a
 * corrected token recovers the run. Any other 4xx is terminal: the request itself is wrong.
 */
export function createPostmarkChannel(
  config: SendConfig,
  fetchImpl: FetchLike = fetch,
): DeliveryChannel {
  return {
    async send(message: DeliveryMessage) {
      let response: Response;
      try {
        response = await fetchImpl(`${config.apiBaseUrl.replace(/\/+$/, '')}/email`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-Postmark-Server-Token': config.token,
          },
          body: JSON.stringify({
            From: message.from,
            To: message.to,
            ...(message.replyTo === null ? {} : { ReplyTo: message.replyTo }),
            Subject: message.subject,
            TextBody: message.textBody,
            MessageStream: config.messageStream,
            Tag: message.tag,
            Metadata: message.metadata,
          }),
          signal: AbortSignal.timeout(config.requestTimeoutMs),
        });
      } catch (error) {
        // The error text can name the host, never the token or the body.
        throw new DeliveryError(
          `Postmark request failed: ${error instanceof Error ? error.name : 'unknown'}`,
          true,
        );
      }

      let payload: { ErrorCode?: unknown; Message?: unknown; MessageID?: unknown } = {};
      try {
        payload = (await response.json()) as typeof payload;
      } catch {
        // Fall through to the status check below.
      }

      const providerMessage = typeof payload.Message === 'string' ? clip(payload.Message) : '';
      if (!response.ok || (payload.ErrorCode !== undefined && payload.ErrorCode !== 0)) {
        const status = response.status;
        const retryable = status === 401 || status === 403 || status === 429 || status >= 500;
        throw new DeliveryError(
          `Postmark rejected the send: HTTP ${status}, ErrorCode ${String(payload.ErrorCode)}. ${providerMessage}`.trim(),
          retryable,
        );
      }
      if (typeof payload.MessageID !== 'string' || payload.MessageID === '') {
        // Accepted without an id is not verifiable. Retry rather than record a delivery.
        throw new DeliveryError('Postmark accepted the send but returned no MessageID.', true);
      }
      return { messageId: payload.MessageID };
    },
  };
}
