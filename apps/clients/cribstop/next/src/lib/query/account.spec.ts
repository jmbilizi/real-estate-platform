import { AuthError } from '@/lib/api/account';
import { accountKeys } from './account';
import { shouldRetry } from './query-client';

describe('accountKeys', () => {
  it('scopes the profile key per user', () => {
    expect(accountKeys.profile('a@x.com')).not.toEqual(accountKeys.profile('b@x.com'));
  });

  it('nests every user key under the account root', () => {
    expect(accountKeys.profile('a@x.com').slice(0, 1)).toEqual(accountKeys.all);
  });

  it('does not retry a 401', () => {
    expect(shouldRetry(0, new AuthError(401))).toBe(false);
  });
});
