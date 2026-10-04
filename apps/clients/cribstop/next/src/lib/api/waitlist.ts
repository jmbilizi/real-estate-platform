/** Early-access interest kinds. Same vocabulary as account-service `WaitlistInterestKinds`. */
export type WaitlistInterest = 'services-consumer' | 'services-provider' | 'connect';

export class WaitlistAuthError extends Error {
  constructor() {
    super('Not signed in');
    this.name = 'WaitlistAuthError';
  }
}

function check(res: Response, fallback: string): void {
  if (res.status === 401) throw new WaitlistAuthError();
  if (!res.ok) throw new Error(fallback);
}

/** Lists the signed-in account's own waitlist interests. */
export async function getWaitlistInterests(): Promise<WaitlistInterest[]> {
  const res = await fetch('/api/account/waitlist');
  check(res, 'Could not load your waitlist status');
  const body = (await res.json().catch(() => null)) as {
    interests?: { interest?: unknown }[];
  } | null;
  return (body?.interests ?? [])
    .map((row) => row.interest)
    .filter((value): value is WaitlistInterest => typeof value === 'string');
}

/** Registers interest. Repeating the call changes nothing. */
export async function joinWaitlist(interest: WaitlistInterest): Promise<void> {
  const res = await fetch('/api/account/waitlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ interest }),
  });
  check(res, 'Could not join the waitlist');
}

/** Withdraws interest. Withdrawing an absent interest succeeds. */
export async function leaveWaitlist(interest: WaitlistInterest): Promise<void> {
  const res = await fetch(`/api/account/waitlist/${encodeURIComponent(interest)}`, {
    method: 'DELETE',
  });
  check(res, 'Could not leave the waitlist');
}
