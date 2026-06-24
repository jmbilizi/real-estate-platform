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
