import { NextResponse } from 'next/server';
import { DEFAULT_PASSWORD_POLICY } from '@/lib/password-rules';

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * Mirrors account-service `PasswordPolicy:MinLength` (default 8) and `PassphraseLength`
 * (default 15) for the checklist. Set `PASSWORD_MIN_LENGTH` and `PASSWORD_PASSPHRASE_LENGTH`
 * when those values change. The server stays the gate. No gateway call.
 */
export async function GET() {
  const minLength = positiveInt(process.env.PASSWORD_MIN_LENGTH, DEFAULT_PASSWORD_POLICY.minLength);
  const passphraseLength = Math.max(
    minLength,
    positiveInt(process.env.PASSWORD_PASSPHRASE_LENGTH, DEFAULT_PASSWORD_POLICY.passphraseLength),
  );
  return NextResponse.json({
    minLength,
    passphraseLength,
    requiredClasses: DEFAULT_PASSWORD_POLICY.requiredClasses,
  });
}
