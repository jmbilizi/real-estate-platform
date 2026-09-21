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

export async function loginAccount(payload: LoginRequest): Promise<LoginResponse> {
  return post<LoginResponse>('/api/account/login', payload);
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
 * address, and an unconfirmed address alike — the server reports all three identically on purpose
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
 * (account-service's own non-enumeration guarantee) — callers must show the same neutral
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
