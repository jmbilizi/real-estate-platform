import request from 'supertest';
import {
  NOT_FOUND_BODY,
  UNAUTHENTICATED_BODY,
  UNAVAILABLE_BODY,
} from '@cribstop/property-contracts';
import { createApp } from '../app';
import type { IntrospectionClient } from '../inquiries/account-introspection';
import type { PropertyRecordDbRow, ReadPool } from '../listings/repository';
import { cardDbRowFixture } from '../listings/test-fixtures';

/**
 * The saved-homes routes (#23) against a FAKE pool. The fake records each statement with its
 * parameters, so these tests can assert that every statement is scoped to the calling account.
 */

const ACCOUNT_A = '0190a000-0000-7000-8000-00000000000a';
const ACCOUNT_B = '0190a000-0000-7000-8000-00000000000b';
const HOME_ID = '0190a000-0000-7000-8000-0000000000f1';
const LISTING_ID = '0190a000-0000-7000-8000-0000000000e1';
const OFF_MARKET_HOME_ID = '0190a000-0000-7000-8000-0000000000f2';

const signedInAs = (accountId: string | null): IntrospectionClient => ({
  resolveAccountId: () => Promise.resolve(accountId),
});

interface Recorded {
  sql: string;
  values: unknown[];
}

function createPool(answer: (sql: string, values: unknown[]) => unknown[]): ReadPool & {
  recorded: Recorded[];
} {
  const recorded: Recorded[] = [];
  const query = <T>(sql: string, values: unknown[] = []): Promise<{ rows: T[] }> => {
    recorded.push({ sql, values });
    return Promise.resolve({ rows: answer(sql, values) as T[] });
  };
  return { recorded, query, connect: () => Promise.resolve({ query, release: () => undefined }) };
}

function detailRow(overrides: Partial<PropertyRecordDbRow> = {}): PropertyRecordDbRow {
  return {
    id: LISTING_ID,
    property_id: HOME_ID,
    unit_id: null,
    listing_data_displayable: true,
    market_status: 'Active',
    address_street: '900 King St',
    unit_number: null,
    city: 'Alexandria',
    state: 'VA',
    zip: '22314',
    property_type: 'Single Family',
    beds: 3,
    baths: 2.5,
    sqft: 1800,
    lot_sqft: 4000,
    year_built: 1990,
    source: 'internal',
    is_sample: false,
    last_updated: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function factsRow(homeId: string) {
  return {
    home_id: homeId,
    city: 'Alexandria',
    state: 'VA',
    zip: '22314',
    neighborhood: 'Old Town',
    property_type: 'Single Family',
    beds: 3,
    baths: 2.5,
    sqft: 1800,
    lot_sqft: 4000,
    year_built: 1990,
    is_sample: false,
  };
}

const header = { Cookie: '.AspNetCore.Identity.Application=abc' };

describe('saved homes: authentication', () => {
  const calls: Array<['get' | 'put' | 'delete', string]> = [
    ['put', `/listings/${LISTING_ID}/saved`],
    ['delete', `/listings/${LISTING_ID}/saved`],
    ['delete', `/saved-homes/${HOME_ID}`],
    ['get', '/saved-homes'],
  ];

  it.each(calls)('%s %s answers 401 for a signed-out caller and runs no SQL', async (m, path) => {
    const pool = createPool(() => []);
    const app = createApp({ pool, introspection: signedInAs(null) });
    const response = await request(app)[m](path);
    expect(response.status).toBe(401);
    expect(response.body).toEqual(UNAUTHENTICATED_BODY);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(pool.recorded).toEqual([]);
  });
});

describe('saved homes: account-service outage and bad ids', () => {
  it('answers a retryable 503, not 401, when account-service gives no answer', async () => {
    const pool = createPool(() => []);
    const introspection: IntrospectionClient = {
      resolveAccountId: () => Promise.resolve(null),
      introspect: () => Promise.resolve({ kind: 'unavailable' }),
    };
    const response = await request(createApp({ pool, introspection }))
      .put(`/listings/${LISTING_ID}/saved`)
      .set(header);

    expect(response.status).toBe(503);
    expect(response.body).toEqual(UNAVAILABLE_BODY);
    expect(response.headers['retry-after']).toBe('2');
    expect(pool.recorded).toEqual([]);
  });

  it('answers 401 when the resolved account id is not a UUID, and runs no SQL', async () => {
    const pool = createPool(() => []);
    const response = await request(createApp({ pool, introspection: signedInAs('not-a-uuid') }))
      .get('/saved-homes')
      .set(header);

    expect(response.status).toBe(401);
    expect(pool.recorded).toEqual([]);
  });

  it('rejects a page number past the safe bound with 400, never a database error', async () => {
    const pool = createPool(() => []);
    const response = await request(createApp({ pool, introspection: signedInAs(ACCOUNT_A) }))
      .get('/saved-homes?page=99999999999999999999')
      .set(header);

    expect(response.status).toBe(400);
    expect(pool.recorded).toEqual([]);
  });
});

describe('PUT /listings/:id/saved', () => {
  it('saves the home of the listing for the calling account only', async () => {
    const pool = createPool((sql) => (sql.includes('listing_detail_v') ? [detailRow()] : []));
    const app = createApp({ pool, introspection: signedInAs(ACCOUNT_A) });
    const response = await request(app).put(`/listings/${LISTING_ID}/saved`).set(header);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ propertyId: HOME_ID, saved: true });
    const insert = pool.recorded.find((entry) => entry.sql.includes('INSERT INTO saved_homes'));
    expect(insert?.sql).toContain('ON CONFLICT (account_id, property_id) DO NOTHING');
    expect(insert?.values).toEqual([ACCOUNT_A, HOME_ID, LISTING_ID]);
  });

  it('keys on the unit id in a subdivided building', async () => {
    const unitId = '0190a000-0000-7000-8000-0000000000d1';
    const pool = createPool((sql) =>
      sql.includes('listing_detail_v') ? [detailRow({ unit_id: unitId })] : [],
    );
    const app = createApp({ pool, introspection: signedInAs(ACCOUNT_A) });
    const response = await request(app).put(`/listings/${LISTING_ID}/saved`).set(header);

    expect(response.body.propertyId).toBe(unitId);
  });

  it('answers the one frozen 404 for an unknown or withheld listing and writes nothing', async () => {
    const pool = createPool(() => []);
    const app = createApp({ pool, introspection: signedInAs(ACCOUNT_A) });
    const response = await request(app).put(`/listings/${LISTING_ID}/saved`).set(header);

    expect(response.status).toBe(404);
    expect(response.body).toEqual(NOT_FOUND_BODY);
    expect(pool.recorded.some((entry) => entry.sql.includes('INSERT'))).toBe(false);
  });

  it('answers the same 404 for a malformed id', async () => {
    const pool = createPool(() => []);
    const app = createApp({ pool, introspection: signedInAs(ACCOUNT_A) });
    const response = await request(app).put('/listings/not-an-id/saved').set(header);

    expect(response.status).toBe(404);
    expect(response.body).toEqual(NOT_FOUND_BODY);
  });
});

describe('DELETE routes', () => {
  it('unsave by listing is scoped to the calling account', async () => {
    const pool = createPool((sql) => (sql.includes('listing_detail_v') ? [detailRow()] : []));
    const app = createApp({ pool, introspection: signedInAs(ACCOUNT_B) });
    const response = await request(app).delete(`/listings/${LISTING_ID}/saved`).set(header);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ propertyId: HOME_ID, saved: false });
    const remove = pool.recorded.find((entry) => entry.sql.includes('DELETE FROM saved_homes'));
    expect(remove?.sql).toContain('account_id = $1');
    expect(remove?.values).toEqual([ACCOUNT_B, HOME_ID]);
  });

  it('unsave by home id works without any listing and is a success when nothing is saved', async () => {
    const pool = createPool(() => []);
    const app = createApp({ pool, introspection: signedInAs(ACCOUNT_A) });
    const response = await request(app).delete(`/saved-homes/${OFF_MARKET_HOME_ID}`).set(header);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ propertyId: OFF_MARKET_HOME_ID, saved: false });
    expect(pool.recorded).toHaveLength(1);
    expect(pool.recorded[0]?.values).toEqual([ACCOUNT_A, OFF_MARKET_HOME_ID]);
  });
});

describe('GET /saved-homes', () => {
  function listPool(listingRows: PropertyRecordDbRow[]) {
    return createPool((sql) => {
      if (sql.includes('count(*) AS count')) return [{ count: '2' }];
      if (sql.includes('FROM saved_homes')) {
        return [
          { property_id: HOME_ID, listing_id: LISTING_ID, created_at: '2026-10-02T00:00:00.000Z' },
          {
            property_id: OFF_MARKET_HOME_ID,
            listing_id: null,
            created_at: '2026-10-01T00:00:00.000Z',
          },
        ];
      }
      if (sql.includes('FROM unnest') && sql.includes('listing_detail_v')) {
        return listingRows.map((row) => ({ ...row, home_id: row.property_id }));
      }
      if (sql.includes('FROM unnest')) {
        return [factsRow(HOME_ID), factsRow(OFF_MARKET_HOME_ID)];
      }
      if (sql.includes('listing_search_v')) {
        return [cardDbRowFixture({ id: LISTING_ID, property_id: HOME_ID, unit_id: null })];
      }
      return [];
    });
  }

  it('returns home-shaped rows: a live listing and an off-market home with a null listing', async () => {
    const pool = listPool([detailRow()]);
    const app = createApp({ pool, introspection: signedInAs(ACCOUNT_A) });
    const response = await request(app).get('/saved-homes').set(header);

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body.total).toBe(2);
    const [live, off] = response.body.results;
    expect(live.propertyId).toBe(HOME_ID);
    expect(live.listing.id).toBe(LISTING_ID);
    expect(live.listing.isSaved).toBe(true);
    expect(off.propertyId).toBe(OFF_MARKET_HOME_ID);
    expect(off.listing).toBeNull();
    expect(off.marketStatus).toBe('Off market');
    expect(off.property.city).toBe('Alexandria');
  });

  it('masks the address for a home with no readable listing', async () => {
    const pool = listPool([]);
    const app = createApp({ pool, introspection: signedInAs(ACCOUNT_A) });
    const response = await request(app).get('/saved-homes').set(header);

    for (const home of response.body.results) {
      expect(home.property.address).toBeNull();
      expect(home.listing).toBeNull();
      expect(home.canonicalPath).toBeNull();
    }
  });

  it('masks the whole home when any one of its listings withheld the address', async () => {
    const withheld = detailRow({
      id: '0190a000-0000-7000-8000-0000000000e2',
      address_street: null,
      listing_data_displayable: false,
      market_status: 'Off market',
      last_updated: '2026-09-01T00:00:00.000Z',
    });
    const pool = listPool([detailRow(), withheld]);
    const app = createApp({ pool, introspection: signedInAs(ACCOUNT_A) });
    const response = await request(app).get('/saved-homes').set(header);

    const live = response.body.results[0];
    expect(live.property.address).toBeNull();
    expect(live.listing.address).toBeNull();
    expect(live.listing.latitude).toBeNull();
    expect(live.listing.longitude).toBeNull();
    expect(live.listing.propertyPath).not.toMatch(/king/i);
    expect(live.canonicalPath).not.toMatch(/king/i);
  });

  it('shows Off market with a null listing when the latest listing left the view', async () => {
    const pool = listPool([
      detailRow({ listing_data_displayable: false, market_status: 'Off market' }),
    ]);
    const app = createApp({ pool, introspection: signedInAs(ACCOUNT_A) });
    const response = await request(app).get('/saved-homes').set(header);

    expect(response.body.results[0].listing).toBeNull();
    expect(response.body.results[0].marketStatus).toBe('Off market');
    expect(response.body.results[0].canonicalPath).toContain(LISTING_ID);
  });

  it('scopes the read to the calling account and uses one statement per kind, not one per home', async () => {
    const pool = listPool([detailRow()]);
    const app = createApp({ pool, introspection: signedInAs(ACCOUNT_B) });
    await request(app).get('/saved-homes').set(header);

    for (const entry of pool.recorded.filter((e) => e.sql.includes('FROM saved_homes'))) {
      expect(entry.sql).toContain('account_id = $1');
      expect(entry.values[0]).toBe(ACCOUNT_B);
    }
    expect(pool.recorded.filter((e) => e.sql.includes('listing_detail_v'))).toHaveLength(1);
    expect(pool.recorded.filter((e) => e.sql.includes('FROM listing_search_v v'))).toHaveLength(1);
  });

  it('rejects an unknown query parameter with 400', async () => {
    const app = createApp({ pool: listPool([]), introspection: signedInAs(ACCOUNT_A) });
    const response = await request(app).get('/saved-homes?fields=id').set(header);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid_request');
  });
});

describe('saved state on the read paths', () => {
  const cardRow = cardDbRowFixture({ id: LISTING_ID, property_id: HOME_ID, unit_id: null });
  const readPool = (saved: boolean) =>
    createPool((sql) => {
      if (sql.includes('count(*)::int AS total')) return [{ total: 1 }];
      if (sql.includes('FROM saved_homes')) return saved ? [{ property_id: HOME_ID }] : [];
      return [cardRow];
    });

  it('adds both flags and a private response for a signed-in search', async () => {
    const pool = readPool(true);
    const app = createApp({ pool, introspection: signedInAs(ACCOUNT_A) });
    const response = await request(app).get('/listings').set(header);

    expect(response.status).toBe(200);
    expect(response.body.results[0].isSaved).toBe(true);
    expect(response.body.results[0].isFavorited).toBe(true);
    expect(response.headers['cache-control']).toBe('private, no-store');
    const lookup = pool.recorded.find((entry) => entry.sql.includes('FROM saved_homes'));
    expect(lookup?.values[0]).toBe(ACCOUNT_A);
  });

  it('adds false for an unsaved home', async () => {
    const app = createApp({ pool: readPool(false), introspection: signedInAs(ACCOUNT_A) });
    const response = await request(app).get('/listings').set(header);

    expect(response.body.results[0].isSaved).toBe(false);
  });

  it('leaves a signed-out search byte-identical: no flags, public cache, no saved lookup', async () => {
    const pool = readPool(true);
    const app = createApp({ pool, introspection: signedInAs(null) });
    const response = await request(app).get('/listings').set(header);

    expect(response.status).toBe(200);
    expect(response.body.results[0]).not.toHaveProperty('isSaved');
    expect(response.body.results[0]).not.toHaveProperty('isFavorited');
    expect(response.headers['cache-control']).toBe('public, max-age=60');
    expect(pool.recorded.some((entry) => entry.sql.includes('saved_homes'))).toBe(false);
  });

  it('adds the flags to the detail of a signed-in caller and keeps an anonymous detail public', async () => {
    const signedIn = createApp({ pool: readPool(true), introspection: signedInAs(ACCOUNT_A) });
    const withFlags = await request(signedIn).get(`/listings/${LISTING_ID}`).set(header);
    expect(withFlags.status).toBe(200);
    expect(withFlags.body.listing.isSaved).toBe(true);
    expect(withFlags.headers['cache-control']).toBe('private, no-store');

    const anonymous = createApp({ pool: readPool(true), introspection: signedInAs(null) });
    const without = await request(anonymous).get(`/listings/${LISTING_ID}`).set(header);
    expect(without.status).toBe(200);
    expect(without.body.listing).not.toHaveProperty('isSaved');
    expect(without.headers['cache-control']).toBe('public, max-age=60');
  });
});
