import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import axios from 'axios';
import {
  LOOKING_FOR_LIMIT_BODY,
  lookingForListSchema,
  lookingForSchema,
  SIGN_IN_REQUIRED_BODY,
} from '@cribstop/property-contracts';
import { closePool, getPool } from '../src/db/pool';
import {
  bearerFor,
  introspectionStubUrl,
  startIntrospectionStub,
  stopIntrospectionStub,
} from './support/introspection-stub';

/**
 * "What I'm looking for" (#768) against a REAL service and a REAL database. The service must run
 * with `ACCOUNT_SERVICE_INTROSPECT_URL` set to the stub this file starts. The concurrency tests
 * fire real parallel requests, so the advisory lock is the only thing that holds the limit.
 */
const place = { kind: 'city', state: 'VA', city: 'Alexandria' };
const body = (overrides: Record<string, unknown> = {}) => ({
  intent: 'buy',
  places: [place],
  ...overrides,
});
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const as = (accountId: string, roles: string[] = []) => ({
  headers: bearerFor(accountId, roles),
  validateStatus: () => true,
});
const anonymous = { validateStatus: () => true };

let stub: Server;
const accounts: string[] = [];
const newAccount = () => {
  const id = randomUUID();
  accounts.push(id);
  return id;
};

const put = (accountId: string, id: string, data: unknown, roles: string[] = []) =>
  axios.put(`/looking-for/${id}`, data, as(accountId, roles));
const list = async (accountId: string) => {
  const response = await axios.get('/looking-for', as(accountId));
  expect(response.status).toBe(200);
  return lookingForListSchema.parse(response.data);
};

beforeAll(async () => {
  stub = await startIntrospectionStub();
  const probe = await axios.get('/looking-for', as(randomUUID()));
  if (probe.status === 401) {
    throw new Error(
      'The service rejected the e2e credential. Start it with ' +
        `ACCOUNT_SERVICE_INTROSPECT_URL=${introspectionStubUrl()}`,
    );
  }
});

afterAll(async () => {
  await getPool().query('DELETE FROM looking_for_preferences WHERE account_id = ANY($1::uuid[])', [
    accounts,
  ]);
  await stopIntrospectionStub(stub);
  await closePool();
});

describe('authentication', () => {
  it('answers 401 with the one body on every route when signed out', async () => {
    const id = randomUUID();
    const responses = await Promise.all([
      axios.get('/looking-for', anonymous),
      axios.put(`/looking-for/${id}`, body(), anonymous),
      axios.delete(`/looking-for/${id}`, anonymous),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.data).toEqual(SIGN_IN_REQUIRED_BODY);
      expect(response.headers['cache-control']).toBe('private, no-store');
    }
  });
});

describe('create, replace, list, delete', () => {
  it('creates (201), replaces (200) and lists the row, newest change first', async () => {
    const account = newAccount();
    expect((await list(account)).items).toEqual([]);
    const first = randomUUID();
    const second = randomUUID();

    const created = await put(
      account,
      first,
      body({
        priceMin: 100000,
        priceMax: 500000,
        bedsMin: 2,
        homeTypes: ['Condo'],
        whenStart: day(5),
        whenEnd: day(30),
      }),
    );
    expect(created.status).toBe(201);
    const item = lookingForSchema.parse(created.data);
    expect(item).toMatchObject({ id: first, intent: 'buy', whenStart: day(5), whenEnd: day(30) });
    expect(item.homeTypes).toEqual(['Condo']);

    expect((await put(account, second, body({ intent: 'rent' }))).status).toBe(201);
    const replaced = await put(account, first, body({ intent: 'rent', priceMax: 400000 }));
    expect(replaced.status).toBe(200);
    expect(replaced.data).toMatchObject({
      id: first,
      intent: 'rent',
      priceMin: null,
      priceMax: 400000,
      homeTypes: [],
      whenStart: null,
      whenEnd: null,
    });

    const { items, max } = await list(account);
    expect(max).toBe(5);
    expect(items.map((i) => i.id)).toEqual([first, second]);
  });

  it('keeps an end date only with a start date', async () => {
    const account = newAccount();
    const response = await put(account, randomUUID(), body({ whenEnd: day(10) }));
    expect(response.status).toBe(400);
    expect(response.data.error.fields).toEqual(['whenEnd']);
  });

  it('deletes idempotently', async () => {
    const account = newAccount();
    const id = randomUUID();
    await put(account, id, body());
    expect((await axios.delete(`/looking-for/${id}`, as(account))).status).toBe(204);
    expect((await axios.delete(`/looking-for/${id}`, as(account))).status).toBe(204);
    expect((await list(account)).items).toEqual([]);
  });
});

describe('validation', () => {
  it.each([
    ['an unknown intent', { intent: 'sell' }, 'intent'],
    ['no places', { places: [] }, 'places'],
    [
      'a neighborhood place',
      { places: [{ kind: 'neighborhood', state: 'VA', name: 'x' }] },
      'places',
    ],
    ['a reversed price range', { priceMin: 9, priceMax: 1 }, 'priceMax'],
    ['an unknown home type', { homeTypes: ['Castle'] }, 'homeTypes'],
    ['a past start date', { whenStart: day(-5) }, 'whenStart'],
    ['a free-text field', { notes: 'quiet street' }, 'notes'],
    ['an account id in the body', { accountId: randomUUID() }, 'accountId'],
  ])('refuses %s and names the field', async (_name, overrides, field) => {
    const account = newAccount();
    const response = await put(account, randomUUID(), body(overrides));
    expect(response.status).toBe(400);
    expect(response.data.error.code).toBe('invalid_request');
    expect(response.data.error.fields).toContain(field);
    expect((await list(account)).items).toEqual([]);
  });

  it('accepts a start date of yesterday and names the parent of a nested extra key', async () => {
    const account = newAccount();
    expect((await put(account, randomUUID(), body({ whenStart: day(-1) }))).status).toBe(201);
    const nested = await put(account, randomUUID(), body({ places: [{ ...place, extra: 1 }] }));
    expect(nested.data.error.fields).toEqual(['places']);
  });

  it('accepts a start date of today and refuses a malformed id', async () => {
    const account = newAccount();
    expect((await put(account, randomUUID(), body({ whenStart: day(0) }))).status).toBe(201);
    const bad = await put(account, 'not-a-uuid', body());
    expect(bad.status).toBe(400);
    expect(bad.data.error.fields).toEqual(['id']);
  });
});

describe('the limit of 5', () => {
  it('answers 409 for a sixth preference and still replaces a known one', async () => {
    const account = newAccount();
    const ids = Array.from({ length: 5 }, () => randomUUID());
    for (const id of ids) expect((await put(account, id, body())).status).toBe(201);

    const sixth = await put(account, randomUUID(), body());
    expect(sixth.status).toBe(409);
    expect(sixth.data).toEqual(LOOKING_FOR_LIMIT_BODY);
    expect((await put(account, ids[0] as string, body({ intent: 'rent' }))).status).toBe(200);
    expect((await list(account)).items).toHaveLength(5);

    await axios.delete(`/looking-for/${ids[1] as string}`, as(account));
    expect((await put(account, randomUUID(), body())).status).toBe(201);
  });

  it('holds the limit under 12 parallel creates of new ids', async () => {
    const account = newAccount();
    const responses = await Promise.all(
      Array.from({ length: 12 }, () => put(account, randomUUID(), body())),
    );
    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(5);
    expect(statuses.filter((s) => s === 409)).toHaveLength(7);
    expect((await list(account)).items).toHaveLength(5);
  });

  it('never answers 500 for parallel puts of one new id, and leaves one row', async () => {
    const account = newAccount();
    const id = randomUUID();
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, i) => put(account, id, body({ bedsMin: i }))),
    );
    for (const response of responses) expect([200, 201]).toContain(response.status);
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect((await list(account)).items).toHaveLength(1);
  });
});

describe('accounts', () => {
  it('isolates accounts, even when they share an id', async () => {
    const a = newAccount();
    const b = newAccount();
    const shared = randomUUID();
    expect((await put(a, shared, body({ intent: 'buy' }))).status).toBe(201);
    expect((await put(b, shared, body({ intent: 'rent' }))).status).toBe(201);

    expect((await list(a)).items[0]).toMatchObject({ id: shared, intent: 'buy' });
    expect((await list(b)).items[0]).toMatchObject({ id: shared, intent: 'rent' });

    await axios.delete(`/looking-for/${shared}`, as(a));
    expect((await list(a)).items).toEqual([]);
    expect((await list(b)).items).toHaveLength(1);
  });

  it('counts the limit per account', async () => {
    const a = newAccount();
    const b = newAccount();
    for (let i = 0; i < 5; i++) await put(a, randomUUID(), body());
    expect((await put(b, randomUUID(), body())).status).toBe(201);
  });

  it('serves a multi-role account one buy and one rent preference', async () => {
    const account = newAccount();
    const roles = ['Owner', 'Renter', 'Buyer', 'Agent', 'Provider'];
    expect((await put(account, randomUUID(), body({ intent: 'buy' }), roles)).status).toBe(201);
    expect((await put(account, randomUUID(), body({ intent: 'rent' }), roles)).status).toBe(201);
    const intents = (await list(account)).items.map((i) => i.intent).sort();
    expect(intents).toEqual(['buy', 'rent']);
  });
});
