import { NextResponse } from 'next/server';

const DEFAULT_EXPIRY_HOURS = 24;

/**
 * Exposes how long a confirmation link stays valid, so the waiting-state copy cannot drift from
 * account-service's configured `AccountRecovery:ConfirmationTokenLifetime` (#147). Set
 * `EMAIL_CONFIRMATION_EXPIRY_HOURS` to the same number of hours when that server value changes.
 * No gateway call: this is local Next.js configuration, not account-service data.
 */
export async function GET() {
  const raw = Number(process.env.EMAIL_CONFIRMATION_EXPIRY_HOURS);
  const expiryHours = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_EXPIRY_HOURS;
  return NextResponse.json({ expiryHours });
}
