interface LoginRequest {
  email: string;
  password: string;
  remember?: boolean;
}

export interface LoginResponse {
  email: string;
  accessToken?: string;
  expiresIn?: number;
}

export interface SessionResponse {
  authenticated: boolean;
  email?: string;
}

export interface ProfileResponse {
  email?: string;
  emailConfirmed?: boolean;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  bio?: string;
  dateOfBirth?: string;
  emailNotificationsEnabled?: boolean;
  smsNotificationsEnabled?: boolean;
  pushNotificationsEnabled?: boolean;
  marketingOptIn?: boolean;
}

export interface ProfileUpdateRequest {
  firstName?: string;
  lastName?: string;
  displayName?: string;
  bio?: string;
  dateOfBirth?: string;
  emailNotificationsEnabled?: boolean;
  smsNotificationsEnabled?: boolean;
  pushNotificationsEnabled?: boolean;
  marketingOptIn?: boolean;
}

async function post<T = unknown>(path: string, payload: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const message =
      typeof body?.error === 'string' && body.error.length > 0
        ? body.error
        : `Request failed (${res.status})`;
    throw new Error(message);
  }

  return body as T;
}

/**
 * A `401` from `/account/login`. Identity answers wrong password and an unconfirmed account with
 * the same status and body (#147), so this carries no more detail than that: a caller must offer
 * both remedies (reset password, resend confirmation) without asserting which applies.
 */
export class SignInFailedError extends Error {
  constructor() {
    super('Sign-in failed');
    this.name = 'SignInFailedError';
  }
}

export async function loginAccount(payload: LoginRequest): Promise<LoginResponse> {
  const res = await fetch('/api/account/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (res.status === 401) throw new SignInFailedError();

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      typeof body?.error === 'string' && body.error.length > 0
        ? body.error
        : `Request failed (${res.status})`;
    throw new Error(message);
  }

  return body as LoginResponse;
}

export async function logoutAccount(): Promise<void> {
  await post('/api/account/logout', {});
}

export async function getSession(): Promise<SessionResponse> {
  const res = await fetch('/api/account/session');
  if (!res.ok) return { authenticated: false };
  return res.json();
}

export class AuthError extends Error {
  constructor(public status: number) {
    super('Authentication failed');
    this.name = 'AuthError';
  }
}

export async function getProfile(): Promise<ProfileResponse> {
  const res = await fetch('/api/account/profile');
  if (res.status === 401) throw new AuthError(401);
  if (!res.ok) throw new Error('Failed to fetch profile');
  return res.json();
}

export async function updateProfile(data: ProfileUpdateRequest): Promise<ProfileResponse> {
  const res = await fetch('/api/account/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update profile');
  return res.json();
}

/** A `429` from the recovery endpoints. `retryAfterSeconds` comes from the server's `Retry-After`. */
export class RateLimitError extends Error {
  constructor(public retryAfterSeconds: number) {
    super('Too many requests');
    this.name = 'RateLimitError';
  }
}

export type PasswordResetErrorKind = 'invalid' | 'policy' | 'failed';

/**
 * A failed `/account/resetPassword` call. `kind: 'invalid'` covers an unusable code, an unknown
 * address, and an unconfirmed address alike. The server reports all three identically on purpose
 * (#137), so this type carries no more detail than the server gives.
 */
export class PasswordResetError extends Error {
  constructor(public kind: PasswordResetErrorKind) {
    super('Password reset failed');
    this.name = 'PasswordResetError';
  }
}

function retryAfterSeconds(res: Response): number {
  const parsed = Number(res.headers.get('Retry-After'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60;
}

/** Redeems a password reset code. `code` and `newPassword` map to Identity's `resetCode`/`newPassword`. */
export async function confirmPasswordReset(payload: {
  email: string;
  code: string;
  newPassword: string;
}): Promise<void> {
  const res = await fetch('/api/account/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: payload.email,
      resetCode: payload.code,
      newPassword: payload.newPassword,
    }),
  });

  if (res.status === 429) throw new RateLimitError(retryAfterSeconds(res));
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const kind: PasswordResetErrorKind =
      body?.error === 'invalid' || body?.error === 'policy' ? body.error : 'failed';
    throw new PasswordResetError(kind);
  }
}

/**
 * Requests a fresh confirmation link. Identity answers unknown, unconfirmed and confirmed
 * addresses identically (#147); callers must show one neutral confirmation for every case.
 */
export async function resendConfirmationEmail(email: string): Promise<void> {
  const res = await fetch('/api/account/resend-confirmation-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });

  if (res.status === 429) throw new RateLimitError(retryAfterSeconds(res));
  if (!res.ok) throw new Error('Unable to send the request');
}

export type ConfirmEmailOutcome = 'confirmed' | 'invalid' | 'rate-limited' | 'error';

/**
 * Redeems a confirmation link's `userId`/`code`. Expired, used, tampered and unknown links all
 * answer `invalid` (#147's non-enumeration guarantee); an already-confirmed link answers
 * `confirmed`, same as a first-time success. Network failures, 5xx and 429 never reject. They
 * answer `error` or `rate-limited`, which the caller can retry (#298).
 */
export async function confirmEmail(payload: {
  userId: string;
  code: string;
}): Promise<ConfirmEmailOutcome> {
  const params = new URLSearchParams({ userId: payload.userId, code: payload.code });
  try {
    const res = await fetch(`/api/account/confirm-email?${params.toString()}`);
    if (res.ok) return 'confirmed';
    if (res.status === 429) return 'rate-limited';
    if (res.status >= 500) return 'error';
    return 'invalid';
  } catch {
    return 'error';
  }
}

const DEFAULT_CONFIRMATION_EXPIRY_HOURS = 24;
let cachedConfirmationExpiryHours: number | null = null;
let inFlightConfirmationExpiry: Promise<number> | null = null;

async function fetchConfirmationExpiryHours(): Promise<number> {
  try {
    const res = await fetch('/api/account/confirmation-info');
    if (res.ok) {
      const body = await res.json().catch(() => null);
      if (typeof body?.expiryHours === 'number' && body.expiryHours > 0) {
        cachedConfirmationExpiryHours = body.expiryHours;
        return body.expiryHours;
      }
    }
  } catch {
    // Network failure. Use the default below.
  }
  return DEFAULT_CONFIRMATION_EXPIRY_HOURS;
}

/**
 * Hours a confirmation link stays valid, read from account-service's configured lifetime (#147)
 * via `/api/account/confirmation-info` so this copy cannot drift from the server's value. Only a
 * real value is cached. A failed lookup returns the 24-hour default and the next call retries
 * (#299). Concurrent calls share one request.
 */
export async function getConfirmationExpiryHours(): Promise<number> {
  if (cachedConfirmationExpiryHours !== null) return cachedConfirmationExpiryHours;
  inFlightConfirmationExpiry ??= fetchConfirmationExpiryHours().finally(() => {
    inFlightConfirmationExpiry = null;
  });
  return inFlightConfirmationExpiry;
}

/** A 503 from the email-code endpoints: codes cannot be sent or checked right now. */
export class CodesUnavailableError extends Error {
  constructor() {
    super('Email codes are unavailable');
    this.name = 'CodesUnavailableError';
  }
}

export interface CodeTiming {
  resendAfterSeconds: number;
  expiresInSeconds: number;
}

export interface IdentifyResult extends CodeTiming {
  next: 'password' | 'code';
}

async function postJson(path: string, payload: unknown): Promise<Response> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (res.status === 429) throw new RateLimitError(retryAfterSeconds(res));
  if (res.status === 503) throw new CodesUnavailableError();
  return res;
}

function toTiming(body: Record<string, unknown> | null): CodeTiming {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  return {
    resendAfterSeconds: num(body?.resendAfterSeconds),
    expiresInSeconds: num(body?.expiresInSeconds),
  };
}

/**
 * Email-first entry call. The answer reveals only the next step, never the account itself.
 * Throws RateLimitError on 429 and CodesUnavailableError on 503.
 */
export async function identifyEmail(email: string): Promise<IdentifyResult> {
  const res = await postJson('/api/account/identify', { email });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error('Unable to continue');
  return { next: body?.next === 'password' ? 'password' : 'code', ...toTiming(body) };
}

export type VerifyCodeResult =
  | { ok: true; signupProof: string }
  | { ok: false; attemptsLeft: number | null };

/** Checks the 6-digit code. A wrong code returns ok: false. A lock throws RateLimitError. */
export async function verifySignupCode(email: string, code: string): Promise<VerifyCodeResult> {
  const res = await postJson('/api/account/signup/verify', { email, code });
  const body = await res.json().catch(() => null);
  if (res.ok && typeof body?.signupProof === 'string') {
    return { ok: true, signupProof: body.signupProof };
  }
  if (res.status === 400 && body?.error === 'invalid_code') {
    const left = body?.attemptsLeft;
    return { ok: false, attemptsLeft: typeof left === 'number' ? left : null };
  }
  throw new Error('Unable to check the code');
}

export async function resendSignupCode(email: string): Promise<CodeTiming> {
  const res = await postJson('/api/account/signup/resend', { email });
  if (!res.ok) throw new Error('Unable to send a new code');
  return toTiming(await res.json().catch(() => null));
}

export async function changeSignupEmail(oldEmail: string, newEmail: string): Promise<CodeTiming> {
  const res = await postJson('/api/account/signup/change-email', { oldEmail, newEmail });
  if (!res.ok) throw new Error('Unable to change the email');
  return toTiming(await res.json().catch(() => null));
}

export type PasswordRejectionCode = 'too_short' | 'too_long' | 'breached';

function knownRejections(errors: unknown): PasswordRejectionCode[] {
  const known: PasswordRejectionCode[] = ['too_short', 'too_long', 'breached'];
  return Array.isArray(errors)
    ? errors.filter((e): e is PasswordRejectionCode => known.includes(e as PasswordRejectionCode))
    : [];
}

export type CompleteSignupOutcome =
  | { ok: true; session: LoginResponse }
  | { ok: false; reason: 'invalid_proof' }
  | { ok: false; reason: 'email_unavailable' }
  | { ok: false; reason: 'password_rejected'; errors: PasswordRejectionCode[] };

/** Sets the password and signs in. The proof is single use and stays in the caller's memory. */
export async function completeSignup(payload: {
  email: string;
  signupProof: string;
  password: string;
}): Promise<CompleteSignupOutcome> {
  const res = await postJson('/api/account/signup/complete', payload);
  const body = await res.json().catch(() => null);
  if (res.ok) return { ok: true, session: body as LoginResponse };
  if (res.status === 401) return { ok: false, reason: 'invalid_proof' };
  if (res.status === 409) return { ok: false, reason: 'email_unavailable' };
  if (res.status === 400 && body?.error === 'password_rejected') {
    return { ok: false, reason: 'password_rejected', errors: knownRejections(body.errors) };
  }
  throw new Error('Unable to create the account');
}

export type VerifyResetResult =
  | { ok: true; resetProof: string }
  | { ok: false; attemptsLeft: number | null };

/** Starts a reset. The answer is the same for every address, so callers show neutral copy. */
export async function startPasswordReset(email: string): Promise<CodeTiming> {
  const res = await postJson('/api/account/password/reset/start', { email });
  if (!res.ok) throw new Error('Unable to send the code');
  return toTiming(await res.json().catch(() => null));
}

/** Checks the reset code. A wrong code returns ok: false. A lock throws RateLimitError. */
export async function verifyResetCode(email: string, code: string): Promise<VerifyResetResult> {
  const res = await postJson('/api/account/password/reset/verify', { email, code });
  const body = await res.json().catch(() => null);
  if (res.ok && typeof body?.resetProof === 'string') {
    return { ok: true, resetProof: body.resetProof };
  }
  if (res.status === 400 && body?.error === 'invalid_code') {
    const left = body?.attemptsLeft;
    return { ok: false, attemptsLeft: typeof left === 'number' ? left : null };
  }
  throw new Error('Unable to check the code');
}

export type CompleteResetOutcome =
  | { ok: true }
  | { ok: false; reason: 'invalid_proof' }
  | { ok: false; reason: 'password_rejected'; errors: PasswordRejectionCode[] };

/** Sets the new password. It signs nobody in: the reset ends every session. */
export async function completePasswordReset(payload: {
  email: string;
  resetProof: string;
  newPassword: string;
}): Promise<CompleteResetOutcome> {
  const res = await postJson('/api/account/password/reset/complete', payload);
  if (res.ok) return { ok: true };
  const body = await res.json().catch(() => null);
  if (res.status === 401) return { ok: false, reason: 'invalid_proof' };
  if (res.status === 400 && body?.error === 'password_rejected') {
    return { ok: false, reason: 'password_rejected', errors: knownRejections(body.errors) };
  }
  throw new Error('Unable to reset the password');
}

export const DEFAULT_PASSWORD_MIN_LENGTH = 15;
let cachedPasswordMinLength: number | null = null;

/** Minimum password length from /api/account/password-policy. Falls back to the default. */
export async function getPasswordMinLength(): Promise<number> {
  if (cachedPasswordMinLength !== null) return cachedPasswordMinLength;
  try {
    const res = await fetch('/api/account/password-policy');
    if (res.ok) {
      const body = await res.json().catch(() => null);
      if (typeof body?.minLength === 'number' && body.minLength > 0) {
        cachedPasswordMinLength = body.minLength;
        return body.minLength;
      }
    }
  } catch {
    // Network failure. Use the default below.
  }
  return DEFAULT_PASSWORD_MIN_LENGTH;
}
