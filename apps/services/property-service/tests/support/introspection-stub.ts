import { createServer, type Server } from 'node:http';

/**
 * A stand-in for account-service's `POST /internal/account/introspect` (#86), for the e2e suites
 * that need a signed-in caller. account-service is not part of this suite's stack.
 *
 * The credential is `Authorization: Bearer e2e-<accountId>`. Anything else resolves as invalid,
 * the same shape the real endpoint answers for a bad credential.
 *
 * It also answers `POST /internal/account/contacts` (#691). `e2e-serve-defaults.js` points
 * `ACCOUNT_SERVICE_CONTACTS_URL` at it.
 *
 * The service under test reads its introspection URL when it starts, so the run must set
 * `ACCOUNT_SERVICE_INTROSPECT_URL` to `introspectionStubUrl()` for the `serve` process:
 *   ACCOUNT_SERVICE_INTROSPECT_URL=http://localhost:3902/internal/account/introspect
 */

const DEFAULT_PORT = 3902;
const PREFIX = 'Bearer e2e-';

export function introspectionStubPort(): number {
  return Number(process.env.PROPERTY_SERVICE_E2E_INTROSPECT_PORT ?? DEFAULT_PORT);
}

export function introspectionStubUrl(): string {
  return `http://localhost:${introspectionStubPort()}/internal/account/introspect`;
}

/** `roles` ride after a `|`, for the staff routes (#632). */
export function bearerFor(
  accountId: string,
  roles: readonly string[] = [],
): { Authorization: string } {
  const suffix = roles.length > 0 ? `|${roles.join(',')}` : '';
  return { Authorization: `${PREFIX}${accountId}${suffix}` };
}

/** Roles the stub reports for `GET /account/{id}/roles` (#634). An unlisted account has none. */
const accountRoles = new Map<string, readonly string[]>();

export function setAccountRoles(accountId: string, roles: readonly string[]): void {
  accountRoles.set(accountId, roles);
}

/** Accounts the stub reports with an unconfirmed email (#690). */
const unconfirmedAccounts = new Set<string>();

export function setEmailUnconfirmed(accountId: string): void {
  unconfirmedAccounts.add(accountId);
}

/** The email the stub reports for an account. */
export function emailFor(accountId: string): string {
  return `${accountId}@e2e.example.com`;
}

/** Contacts the stub reports for `POST /internal/account/contacts` (#689, #691). */
const contactOverrides = new Map<string, { displayName?: string; email?: string }>();
const missingAccounts = new Set<string>();
let contactsDown = false;

/** Sets the display name or email the stub reports for an account. */
export function setContact(accountId: string, contact: { displayName?: string; email?: string }) {
  contactOverrides.set(accountId, contact);
}

/** The stub leaves this account out of the contacts answer, like a deleted account. */
export function setAccountMissing(accountId: string): void {
  missingAccounts.add(accountId);
}

/** The stub answers 503 to the contacts call while `down` is true. */
export function setContactsDown(down: boolean): void {
  contactsDown = down;
}

export function displayNameFor(accountId: string): string {
  return contactOverrides.get(accountId)?.displayName ?? `E2E ${accountId.slice(0, 8)}`;
}

export function startIntrospectionStub(): Promise<Server> {
  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/internal/account/contacts') {
      let raw = '';
      req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        if (contactsDown) {
          res.statusCode = 503;
          res.end('{}');
          return;
        }
        const { accountIds = [] } = JSON.parse(raw) as { accountIds?: string[] };
        const contacts = accountIds
          .filter((id) => !missingAccounts.has(id))
          .map((id) => ({
            accountId: id,
            displayName: displayNameFor(id),
            email: contactOverrides.get(id)?.email ?? emailFor(id),
            emailConfirmed: !unconfirmedAccounts.has(id),
          }));
        res.end(JSON.stringify({ contacts }));
      });
      return;
    }
    const rolesMatch = /^\/account\/([^/]+)\/roles$/.exec(req.url ?? '');
    if (rolesMatch !== null) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(accountRoles.get(decodeURIComponent(rolesMatch[1] ?? '')) ?? []));
      return;
    }
    const authorization = req.headers.authorization ?? '';
    const credential = authorization.startsWith(PREFIX) ? authorization.slice(PREFIX.length) : null;
    const [accountId = null, roleList = ''] = credential?.split('|') ?? [];
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(
      JSON.stringify({
        isValid: accountId !== null,
        accountId,
        roles: roleList === '' ? [] : roleList.split(','),
        ...(accountId === null
          ? {}
          : { email: emailFor(accountId), emailConfirmed: !unconfirmedAccounts.has(accountId) }),
      }),
    );
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(introspectionStubPort(), () => resolve(server));
  });
}

export function stopIntrospectionStub(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}
