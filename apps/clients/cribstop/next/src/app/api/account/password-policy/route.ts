import { NextResponse } from 'next/server';

const DEFAULT_MIN_LENGTH = 15;

/**
 * Exposes the minimum password length, so the sign-up copy cannot drift from account-service's
 * `PasswordPolicy:MinLength`. Set `PASSWORD_MIN_LENGTH` to the same number when that server value
 * changes. No gateway call: this is local Next.js configuration.
 */
export async function GET() {
  const raw = Number(process.env.PASSWORD_MIN_LENGTH);
  const minLength = Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_MIN_LENGTH;
  return NextResponse.json({ minLength });
}
