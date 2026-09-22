interface LoginRequest {
  email: string;
  password: string;
  remember?: boolean;
}

interface SignupRequest {
  email: string;
  password: string;
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

export async function signupAccount(payload: SignupRequest): Promise<void> {
  await post('/api/account/signup', payload);
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

/**
 * Requests a password reset link. The response never reveals whether the address has an account
 * (account-service's own non-enumeration guarantee). Callers must show the same neutral
 * confirmation for every email, and only distinguish an actual failed request.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const res = await fetch('/api/account/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });

  if (res.status === 429) throw new RateLimitError(retryAfterSeconds(res));
  if (!res.ok) throw new Error('Unable to send the request');
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

export type ConfirmEmailOutcome = 'confirmed' | 'invalid';

/**
 * Redeems a confirmation link's `userId`/`code`. Expired, used, tampered and unknown links all
 * answer `invalid` (#147's non-enumeration guarantee); an already-confirmed link answers
 * `confirmed`, same as a first-time success.
 */
export async function confirmEmail(payload: {
  userId: string;
  code: string;
}): Promise<ConfirmEmailOutcome> {
  const params = new URLSearchParams({ userId: payload.userId, code: payload.code });
  const res = await fetch(`/api/account/confirm-email?${params.toString()}`);
  return res.ok ? 'confirmed' : 'invalid';
}

let cachedConfirmationExpiryHours: number | null = null;

/**
 * Hours a confirmation link stays valid, read from account-service's configured lifetime (#147)
 * via `/api/account/confirmation-info` so this copy cannot drift from the server's value. Cached
 * for the tab's lifetime since it does not change between requests.
 */
export async function getConfirmationExpiryHours(): Promise<number> {
  if (cachedConfirmationExpiryHours !== null) return cachedConfirmationExpiryHours;

  try {
    const res = await fetch('/api/account/confirmation-info');
    if (res.ok) {
      const body = await res.json().catch(() => null);
      const hours: number | null =
        typeof body?.expiryHours === 'number' && body.expiryHours > 0 ? body.expiryHours : null;
      if (hours !== null) {
        cachedConfirmationExpiryHours = hours;
        return hours;
      }
    }
  } catch {
    // Network failure — fall through to the default below.
  }

  cachedConfirmationExpiryHours = 24;
  return cachedConfirmationExpiryHours;
}
