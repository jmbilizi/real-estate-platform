import { DEVICE_COOKIE } from '@/app/api/_lib/cookies';

function cookieValue(header: string | null, name: string): string {
  for (const part of (header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return '';
}

/** A short device name for the device list, from the User-Agent. Never the raw header. */
export function deviceLabel(userAgent: string | null): string {
  const ua = userAgent ?? '';
  let browser = 'Browser';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\//.test(ua)) browser = 'Opera';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua)) browser = 'Safari';

  let os = '';
  if (/Windows/.test(ua)) os = 'Windows';
  else if (/iPhone|iPad/.test(ua)) os = 'iOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';

  return os ? `${browser} on ${os}` : browser;
}

/**
 * The timing and reason fields the browser needs for the code step. `sent` is false when the
 * account queued no code (#813), so the step shows the same cooldown and cap copy as sign-up.
 */
export function deviceTiming(body: unknown, challenge = false): Record<string, unknown> {
  const b = (body ?? {}) as Record<string, unknown>;
  const reason = typeof b.reason === 'string' ? b.reason : null;
  return {
    ...(challenge ? { deviceCodeRequired: true } : {}),
    resendAfterSeconds: typeof b.resendAfterSeconds === 'number' ? b.resendAfterSeconds : 0,
    expiresInSeconds: typeof b.expiresInSeconds === 'number' ? b.expiresInSeconds : 0,
    sent: reason === null,
    ...(reason ? { reason } : {}),
  };
}

/** The headers that tell account-service which device this is and how to name it. */
export function deviceHeaders(req: { headers: Headers }): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Device-Label': deviceLabel(req.headers.get('user-agent')),
  };
  const token = cookieValue(req.headers.get('cookie'), DEVICE_COOKIE);
  if (token) headers['X-Device-Token'] = token;
  return headers;
}
