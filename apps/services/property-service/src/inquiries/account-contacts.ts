/**
 * Server-to-server client for account-service's `POST /internal/account/contacts` (#689). A lead
 * stores only the account id (#691), so every staff and agent read resolves the buyer's name and
 * email here. Nothing is cached: a contact is current at read time on purpose.
 *
 * The endpoint carries the same in-cluster trust as credential introspection, so the call sends
 * no credential.
 */

/** The most ids one request may carry. account-service answers 400 above it. */
export const CONTACTS_BATCH_MAX = 100;

/** `displayName` and `email` are nullable in account-service (`ContactLookupItem`). */
export interface AccountContact {
  accountId: string;
  displayName: string | null;
  email: string | null;
  emailConfirmed: boolean;
}

/** The buyer name a dashboard shows: the display name, else the email. */
export function contactName(contact: AccountContact): string | null {
  return contact.displayName ?? contact.email;
}

/** Contacts by account id. An id that account-service does not know has no entry. */
export type ContactMap = ReadonlyMap<string, AccountContact>;

export interface ContactsClient {
  /**
   * Resolves the contacts of `accountIds` in one batch per 100 ids. It never rejects. An id
   * that account-service omits, or whose batch failed, has no entry, so a caller shows
   * "unavailable" for it and still renders the page.
   */
  lookup(accountIds: readonly string[]): Promise<ContactMap>;
}

export interface HttpContactsClientOptions {
  /** account-service's internal contacts URL, see `ACCOUNT_SERVICE_CONTACTS_URL`. */
  url: string;
  timeoutMs: number;
}

function isContact(value: unknown): value is AccountContact {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.accountId === 'string' &&
    (c.displayName === null || typeof c.displayName === 'string') &&
    (c.email === null || typeof c.email === 'string') &&
    typeof c.emailConfirmed === 'boolean'
  );
}

export function createHttpContactsClient(options: HttpContactsClientOptions): ContactsClient {
  async function fetchBatch(accountIds: string[]): Promise<AccountContact[] | null> {
    try {
      const response = await fetch(options.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountIds }),
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      if (!response.ok) {
        console.warn(`Account contacts lookup answered ${response.status}.`);
        return null;
      }
      const body = (await response.json()) as { contacts?: unknown };
      if (!Array.isArray(body.contacts)) return null;
      return body.contacts.filter(isContact).filter((c) => accountIds.includes(c.accountId));
    } catch (error) {
      console.warn('Account contacts lookup failed.', error);
      return null;
    }
  }

  return {
    async lookup(accountIds) {
      const unique = [...new Set(accountIds)];
      if (unique.length === 0) return new Map();
      const batches: string[][] = [];
      for (let i = 0; i < unique.length; i += CONTACTS_BATCH_MAX) {
        batches.push(unique.slice(i, i + CONTACTS_BATCH_MAX));
      }
      const answers = await Promise.all(batches.map(fetchBatch));
      const map = new Map<string, AccountContact>();
      for (const answer of answers) {
        for (const contact of answer ?? []) map.set(contact.accountId, contact);
      }
      return map;
    },
  };
}
