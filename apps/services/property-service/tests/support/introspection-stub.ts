import { createServer, type Server } from 'node:http';

/**
 * A stand-in for account-service's `POST /internal/account/introspect` (#86), for the e2e suites
 * that need a signed-in caller. account-service is not part of this suite's stack.
 *
 * The credential is `Authorization: Bearer e2e-<accountId>`. Anything else resolves as invalid,
 * the same shape the real endpoint answers for a bad credential.
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

export function startIntrospectionStub(): Promise<Server> {
  const server = createServer((req, res) => {
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
