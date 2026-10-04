import { confirmEmail } from './account';

const payload = { userId: 'user-1', code: 'abc' };

function mockFetch(impl: () => Promise<Partial<Response>>) {
  global.fetch = jest.fn(impl) as unknown as typeof fetch;
}

describe('confirmEmail', () => {
  it('answers confirmed on 200', async () => {
    mockFetch(async () => ({ ok: true, status: 200 }));
    await expect(confirmEmail(payload)).resolves.toBe('confirmed');
  });

  it('answers invalid on 401 and 400', async () => {
    mockFetch(async () => ({ ok: false, status: 401 }));
    await expect(confirmEmail(payload)).resolves.toBe('invalid');
    mockFetch(async () => ({ ok: false, status: 400 }));
    await expect(confirmEmail(payload)).resolves.toBe('invalid');
  });

  it('answers rate-limited on 429', async () => {
    mockFetch(async () => ({ ok: false, status: 429 }));
    await expect(confirmEmail(payload)).resolves.toBe('rate-limited');
  });

  it('answers error on 5xx, not invalid', async () => {
    mockFetch(async () => ({ ok: false, status: 503 }));
    await expect(confirmEmail(payload)).resolves.toBe('error');
  });

  it('answers error when the request rejects', async () => {
    mockFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(confirmEmail(payload)).resolves.toBe('error');
  });
});
