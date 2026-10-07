import type { ConsentChannel, ConsentTextVersion, InquiryKind } from '@cribstop/property-contracts';

export interface InquiryInput {
  kind: InquiryKind;
  name: string;
  email: string;
  phone?: string;
  message?: string;
  /** The disclosure version shown beside the submit button (#631). */
  consentTextVersion: ConsentTextVersion;
  consentChannels: ConsentChannel[];
}

/** `unavailable`: the listing is gone, so a retry cannot work. `retryable`: the user may try again. */
export type InquiryFailure = 'unavailable' | 'invalid' | 'rate_limited' | 'retryable';

export class InquiryError extends Error {
  constructor(readonly failure: InquiryFailure) {
    super(`Inquiry failed: ${failure}`);
    this.name = 'InquiryError';
  }
}

export async function submitInquiry(listingId: string, input: InquiryInput): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api/listings/${encodeURIComponent(listingId)}/inquiries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch {
    throw new InquiryError('retryable');
  }
  if (res.ok) return;
  if (res.status === 404) throw new InquiryError('unavailable');
  if (res.status === 400) throw new InquiryError('invalid');
  if (res.status === 429) throw new InquiryError('rate_limited');
  throw new InquiryError('retryable');
}
