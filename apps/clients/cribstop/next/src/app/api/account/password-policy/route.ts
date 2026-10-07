import { NextResponse } from 'next/server';

const DEFAULT_MIN_LENGTH = 15;

/**
 * Mirrors account-service `PasswordPolicy:MinLength` (default 15) for the sign-up copy. Set
 * `PASSWORD_MIN_LENGTH` when that value changes. The server stays the gate. No gateway call.
 */
export async function GET() {
  const raw = Number(process.env.PASSWORD_MIN_LENGTH);
  const minLength = Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_MIN_LENGTH;
  return NextResponse.json({ minLength });
}
