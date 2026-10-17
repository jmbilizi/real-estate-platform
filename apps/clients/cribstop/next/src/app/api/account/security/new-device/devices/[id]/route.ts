import { NextRequest, NextResponse } from 'next/server';
import { badRequest, relay, unavailable } from '@/app/api/_lib/account-relay';
import { requestAuthed } from '@/app/api/_lib/authed-relay';

const GUID = /^[0-9a-fA-F-]{36}$/;

/** Signs a device out of "trusted". It asks for a code at its next sign-in. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!GUID.test(id)) return badRequest();

  const upstream = await requestAuthed(
    'DELETE',
    req,
    `/account/security/new-device/devices/${id}`,
    undefined,
    'trusted device removal',
  );
  if (!upstream) return unavailable();
  if (upstream.status === 204) return new NextResponse(null, { status: 204 });
  return relay(upstream);
}
