import { NextResponse } from 'next/server';
import { fetchGateway } from '@/app/api/_lib/gateway';

/** Only these upstream fields reach the browser. */
const FORWARDED_FIELDS = [
  'next',
  'stepUp',
  'resendAfterSeconds',
  'expiresInSeconds',
  'signupProof',
  'resetProof',
  'error',
  'attemptsLeft',
  'errors',
] as const;

export function stringField(body: unknown, key: string): string {
  const value = (body as Record<string, unknown> | null)?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function badRequest(error = 'invalid_request') {
  return NextResponse.json({ error }, { status: 400 });
}

export function unavailable() {
  return NextResponse.json({ error: 'unavailable' }, { status: 503 });
}

export async function callGateway(
  path: string,
  payload: unknown,
  label: string,
): Promise<Response | null> {
  return fetchGateway(
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    },
    60_000, // .NET cold-start + EF Core pool init can be slow on first request
  ).catch((err: unknown) => {
    // Log the failure only. The payload holds the email, code, proof or password.
    console.error(`Gateway ${label} failed`, err instanceof Error ? err.message : 'unknown');
    return null;
  });
}

/** Forwards the status, Retry-After and the allowed body fields of an upstream answer. */
export async function relay(upstream: Response): Promise<NextResponse> {
  if (upstream.status === 204) return new NextResponse(null, { status: 204 });
  const body = (await upstream.json().catch(() => null)) as Record<string, unknown> | null;
  const safe: Record<string, unknown> = {};
  for (const key of FORWARDED_FIELDS) {
    if (body && key in body) safe[key] = body[key];
  }
  const res = NextResponse.json(safe, { status: upstream.status });
  const retryAfter = upstream.headers.get('retry-after');
  if (retryAfter) res.headers.set('Retry-After', retryAfter);
  return res;
}

export async function relayPost(
  path: string,
  payload: unknown,
  label: string,
): Promise<NextResponse> {
  const upstream = await callGateway(path, payload, label);
  return upstream ? relay(upstream) : unavailable();
}
