import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CONTACTS_BATCH_MAX, createHttpContactsClient } from './account-contacts';

const contactOf = (accountId: string) => ({
  accountId,
  displayName: `Name ${accountId}`,
  email: `${accountId}@example.com`,
  emailConfirmed: true,
});

type Handler = (ids: string[]) => { status: number; body?: unknown; delayMs?: number };

function start(handler: Handler): Promise<{ server: Server; url: string; bodies: string[][] }> {
  const bodies: string[][] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
    req.on('end', () => {
      const ids = (JSON.parse(raw) as { accountIds: string[] }).accountIds;
      bodies.push(ids);
      const answer = handler(ids);
      setTimeout(() => {
        res.statusCode = answer.status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(answer.body ?? {}));
      }, answer.delayMs ?? 0);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}/internal/account/contacts`, bodies });
    });
  });
}

describe('createHttpContactsClient (#691)', () => {
  let server: Server | undefined;
  afterEach(() => {
    server?.closeAllConnections();
    server?.close();
    server = undefined;
  });
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterAll(() => jest.restoreAllMocks());

  it('sends the ids once, de-duplicated, and maps the contacts by account id', async () => {
    const started = await start((ids) => ({
      status: 200,
      body: { contacts: ids.filter((id) => id !== 'gone').map(contactOf) },
    }));
    server = started.server;
    const client = createHttpContactsClient({ url: started.url, timeoutMs: 1000 });

    const found = await client.lookup(['a', 'b', 'a', 'gone']);

    expect(started.bodies).toEqual([['a', 'b', 'gone']]);
    expect(found.get('a')?.displayName).toBe('Name a');
    expect(found.has('gone')).toBe(false);
  });

  it('accepts a null display name or email, and ignores an id nobody asked for', async () => {
    const started = await start(() => ({
      status: 200,
      body: {
        contacts: [
          { accountId: 'a', displayName: null, email: 'a@example.com', emailConfirmed: true },
          { accountId: 'b', displayName: 'B', email: null, emailConfirmed: false },
          contactOf('stranger'),
        ],
      },
    }));
    server = started.server;
    const found = await createHttpContactsClient({ url: started.url, timeoutMs: 1000 }).lookup([
      'a',
      'b',
    ]);
    expect([...found.keys()].sort()).toEqual(['a', 'b']);
    expect(found.get('a')?.displayName).toBeNull();
  });

  it('sends no request for no ids', async () => {
    const started = await start(() => ({ status: 200, body: { contacts: [] } }));
    server = started.server;
    const found = await createHttpContactsClient({ url: started.url, timeoutMs: 1000 }).lookup([]);
    expect(found.size).toBe(0);
    expect(started.bodies).toEqual([]);
  });

  it('splits more than 100 ids into batches of 100', async () => {
    const started = await start((ids) => ({ status: 200, body: { contacts: ids.map(contactOf) } }));
    server = started.server;
    const ids = Array.from({ length: CONTACTS_BATCH_MAX + 1 }, (_, i) => `id-${i}`);

    const found = await createHttpContactsClient({ url: started.url, timeoutMs: 1000 }).lookup(ids);

    expect(started.bodies.map((b) => b.length).sort()).toEqual([1, CONTACTS_BATCH_MAX]);
    expect(found.size).toBe(CONTACTS_BATCH_MAX + 1);
  });

  it.each([
    ['a non-2xx answer', { status: 503 }],
    ['a body with no contacts', { status: 200, body: { nope: true } }],
    ['a slow answer', { status: 200, body: { contacts: [contactOf('a')] }, delayMs: 300 }],
  ])('returns no contact for %s', async (_name, answer) => {
    const started = await start(() => answer);
    server = started.server;
    const client = createHttpContactsClient({ url: started.url, timeoutMs: 100 });
    expect((await client.lookup(['a'])).size).toBe(0);
  });

  it('returns no contact when nothing listens', async () => {
    const client = createHttpContactsClient({
      url: 'http://127.0.0.1:1/internal/account/contacts',
      timeoutMs: 200,
    });
    expect((await client.lookup(['a'])).size).toBe(0);
  });

  it('keeps the contacts of the batches that answered when one batch fails', async () => {
    const started = await start((ids) =>
      ids.includes('id-0')
        ? { status: 500 }
        : { status: 200, body: { contacts: ids.map(contactOf) } },
    );
    server = started.server;
    const ids = Array.from({ length: CONTACTS_BATCH_MAX + 1 }, (_, i) => `id-${i}`);
    const client = createHttpContactsClient({ url: started.url, timeoutMs: 1000 });
    const found = await client.lookup(ids);
    expect(found.size).toBe(1);
    expect(found.has('id-0')).toBe(false);
    expect(found.has('id-100')).toBe(true);
  });
});
