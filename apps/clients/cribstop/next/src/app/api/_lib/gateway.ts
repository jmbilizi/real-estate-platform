const GATEWAY_TIMEOUT_MS = 30_000;

/**
 * Returns the base URL of the API gateway.
 *
 * Resolution order:
 *  1. API_GATEWAY_URL env var (server-side only — never NEXT_PUBLIC_)
 *  2. In development: http://localhost:8080 (skaffold port-forward default)
 *  3. In production: throws (must be explicitly configured)
 *
 * Environment examples:
 *  - Local dev (standalone Next.js):  not set → defaults to localhost:8080
 *  - K8s (any environment):           API_GATEWAY_URL=http://api-gateway-svc:8080
 */
export function gatewayBaseUrl(): string {
  const url = process.env.API_GATEWAY_URL;
  if (url) return url.replace(/\/$/, '');

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'API_GATEWAY_URL is not configured. Set it to the cluster-internal gateway address.',
    );
  }

  return 'http://localhost:8080';
}

/** True for a Kubernetes in-cluster service DNS name, e.g. "api-gateway-svc" or "*.svc.cluster.local". */
function isClusterInternalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1') return false;
  return !host.includes('.') || host.endsWith('.svc') || host.endsWith('.svc.cluster.local');
}

/**
 * Builds the `Authorization: Basic` header for the deployed dev gateway's ingress auth.
 *
 * `API_GATEWAY_BASIC_AUTH` ("user:password") is server-only, optional, and used only by a
 * frontend-only lane running the Next.js dev server (`pnpm run cribstop:web`) against the deployed
 * dev gateway. Node fetch cannot carry credentials embedded in a URL, so the ingress basic auth has
 * to travel as a header instead.
 *
 * A cluster-internal gateway (`api-gateway-svc`) sits behind no ingress auth, so this var has no
 * purpose there. Refusing the combination in production catches a var that leaked into the wrong
 * environment instead of silently sending a credential nothing checks.
 */
function resolveBasicAuthHeader(baseUrl: string): string | null {
  const credentials = process.env.API_GATEWAY_BASIC_AUTH;
  if (!credentials) return null;

  if (process.env.NODE_ENV === 'production') {
    let hostname: string | null = null;
    try {
      hostname = new URL(baseUrl).hostname;
    } catch {
      hostname = null;
    }
    if (hostname && isClusterInternalHost(hostname)) {
      throw new Error(
        'API_GATEWAY_BASIC_AUTH is set in production against a cluster-internal gateway URL. ' +
          'Unset it: in-cluster traffic carries no ingress auth to satisfy.',
      );
    }
  }

  return `Basic ${Buffer.from(credentials, 'utf8').toString('base64')}`;
}

/**
 * Fetch a gateway endpoint with an automatic timeout.
 * @param path     Gateway path, e.g. "/account/login"
 * @param init     Standard RequestInit (method, headers, body, etc.)
 * @param timeoutMs Override the default timeout (default: 30s). Use a higher value
 *                  for auth routes where cold-start JIT + EF Core pool init can be slow.
 */
export async function fetchGateway(
  path: string,
  init: RequestInit,
  timeoutMs = GATEWAY_TIMEOUT_MS,
): Promise<Response> {
  const baseUrl = gatewayBaseUrl();
  const url = `${baseUrl}${path}`;
  const headers = new Headers(init.headers);

  // The ingress basic auth and the backend's own Bearer auth share the one Authorization header,
  // so a caller that already sets it (account routes forwarding a user's token) wins. Those calls
  // are out of scope for the dev-gateway override; only unauthenticated loaders use it today.
  if (!headers.has('Authorization')) {
    const authHeader = resolveBasicAuthHeader(baseUrl);
    if (authHeader) headers.set('Authorization', authHeader);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
