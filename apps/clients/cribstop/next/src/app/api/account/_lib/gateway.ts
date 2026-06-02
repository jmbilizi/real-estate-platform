const GATEWAY_REQUEST_TIMEOUT_MS = 10_000;

export function resolveGatewayUrl(): string {
  const configuredUrl = process.env.NEXT_PUBLIC_API_URL ?? process.env.API_URL;
  if (configuredUrl) {
    return configuredUrl.replace(/\/$/, '');
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('API gateway URL is not configured');
  }

  return 'http://localhost:8080';
}

export async function fetchGateway(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GATEWAY_REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}
