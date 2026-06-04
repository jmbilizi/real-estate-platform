const GATEWAY_TIMEOUT_MS = 10_000;

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

/**
 * Fetch a gateway endpoint with an automatic timeout.
 * @param path  Gateway path, e.g. "/account/login"
 * @param init  Standard RequestInit (method, headers, body, etc.)
 */
export async function fetchGateway(path: string, init: RequestInit): Promise<Response> {
  const url = `${gatewayBaseUrl()}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
