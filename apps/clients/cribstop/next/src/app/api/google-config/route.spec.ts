/** @jest-environment node */
import { GET } from './route';

const original = process.env.GOOGLE_CLIENT_ID;

afterEach(() => {
  if (original === undefined) delete process.env.GOOGLE_CLIENT_ID;
  else process.env.GOOGLE_CLIENT_ID = original;
});

describe('GET /api/google-config', () => {
  it('returns null when no client ID is set', async () => {
    delete process.env.GOOGLE_CLIENT_ID;

    expect(await (await GET()).json()).toEqual({ clientId: null });
  });

  it('treats an empty value and the secret placeholder as unset', async () => {
    process.env.GOOGLE_CLIENT_ID = '  ';
    expect((await (await GET()).json()).clientId).toBeNull();
    process.env.GOOGLE_CLIENT_ID = 'StrongBase64Password';
    expect((await (await GET()).json()).clientId).toBeNull();
  });

  it('returns the client ID', async () => {
    process.env.GOOGLE_CLIENT_ID = 'abc.apps.googleusercontent.com';

    expect(await (await GET()).json()).toEqual({ clientId: 'abc.apps.googleusercontent.com' });
  });
});
