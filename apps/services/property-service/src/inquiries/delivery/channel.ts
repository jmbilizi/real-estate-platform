/**
 * The one seam for delivery (#134). The worker knows this interface and nothing about Postmark.
 * If intake moves to a CRM or a queue, add another implementation. Do not change the worker.
 */

export interface DeliveryMessage {
  to: string;
  from: string;
  replyTo: string | null;
  subject: string;
  textBody: string;
  /** Postmark tag. Lets the intake team filter these in the provider dashboard. */
  tag: string;
  /** Provider metadata. Never consumer data. */
  metadata: Record<string, string>;
}

export interface DeliveryReceipt {
  /** The provider's id for the accepted message. Stored as proof of acceptance. */
  messageId: string;
}

/** A failed send. `retryable` decides between backoff and a terminal `failed`. */
export class DeliveryError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'DeliveryError';
  }
}

export interface DeliveryChannel {
  send(message: DeliveryMessage): Promise<DeliveryReceipt>;
}
