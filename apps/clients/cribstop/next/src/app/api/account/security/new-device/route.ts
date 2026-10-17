import { NextRequest, NextResponse } from 'next/server';
import { badRequest, relay, unavailable } from '@/app/api/_lib/account-relay';
import { requestAuthed } from '@/app/api/_lib/authed-relay';
import { deviceCookie } from '@/app/api/_lib/cookies';

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** The setting and the device list. Only these fields reach the browser. */
export async function GET(req: NextRequest) {
  const upstream = await requestAuthed(
    'GET',
    req,
    '/account/security/new-device',
    undefined,
    'new device setting',
  );
  if (!upstream) return unavailable();
  if (!upstream.ok) return relay(upstream);
  const body = (await upstream.json().catch(() => null)) as {
    enabled?: unknown;
    devices?: unknown;
  } | null;
  const devices = Array.isArray(body?.devices) ? body.devices : [];
  return NextResponse.json({
    enabled: body?.enabled === true,
    devices: devices.map((d: Record<string, unknown>) => ({
      id: text(d.id),
      label: text(d.label),
      firstSeenAt: text(d.firstSeenAt),
      lastUsedAt: text(d.lastUsedAt),
      current: d.current === true,
    })),
  });
}

/** Turns the setting on or off. The password is the step-up proof and is never trimmed. */
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : '';
  if (typeof body?.enabled !== 'boolean' || !currentPassword) return badRequest();

  const upstream = await requestAuthed(
    'PUT',
    req,
    '/account/security/new-device',
    { enabled: body.enabled, currentPassword },
    'new device setting',
  );
  if (!upstream) return unavailable();
  if (!upstream.ok) return relay(upstream);

  const result = (await upstream.json().catch(() => null)) as { enabled?: unknown } | null;
  const res = NextResponse.json({ enabled: result?.enabled === true });
  // Turning it on trusts this browser, so the next sign-in here does not ask for a code.
  const device = deviceCookie(upstream);
  if (device) res.cookies.set(device.name, device.value, device.opts);
  return res;
}
