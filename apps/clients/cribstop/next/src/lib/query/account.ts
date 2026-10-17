import { queryOptions } from '@tanstack/react-query';
import { getProfile } from '@/lib/api/account';
import { getNotificationPreferences } from '@/lib/api/notification-preferences';

/**
 * Account keys. Their own export keeps parallel tickets out of `keys.ts`. The user is the signed-in
 * email, because the web `User` has no id. A per-user key never shares a cache entry across accounts.
 */
export const accountKeys = {
  all: ['account'] as const,
  user: (email: string) => [...accountKeys.all, email] as const,
  profile: (email: string) => [...accountKeys.user(email), 'profile'] as const,
  consentWording: () => [...accountKeys.all, 'consent-wording'] as const,
};

/** The profile of one signed-in user. A 401 throws `AuthError`, and the query never retries it. */
export function profileOptions(email: string) {
  return queryOptions({
    queryKey: accountKeys.profile(email),
    queryFn: ({ signal }) => getProfile(signal),
  });
}

/** The server-held email consent wording. It is public config, so the key has no user. */
export function consentWordingOptions() {
  return queryOptions({
    queryKey: accountKeys.consentWording(),
    queryFn: ({ signal }) => getNotificationPreferences(signal).then((p) => p.consentWording),
  });
}
