import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import axios from 'axios';
import {
  idSchema,
  NOT_FOUND_BODY,
  savedHomesEnvelopeSchema,
  UNAUTHENTICATED_BODY,
} from '@cribstop/property-contracts';
import { closePool, getPool } from '../src/db/pool';
import { payloadLeaksAddress } from './support/address-leak-scan';
import { complianceFixtureIds } from './support/fixture-ids';
import {
  bearerFor,
  introspectionStubUrl,
  startIntrospectionStub,
  stopIntrospectionStub,
} from './support/introspection-stub';

/**
 * Saved homes (#23) against a REAL service and REAL database, with the guarded compliance fixtures.
 *
 * The service must run with `ACCOUNT_SERVICE_INTROSPECT_URL` set to the stub this file starts.
 * See tests/support/introspection-stub.ts. Without it, every signed-in call here answers 401.
 */
const fixtures = complianceFixtureIds();
const accountA = randomUUID();
const accountB = randomUUID();
const asA = { headers: bearerFor(accountA), validateStatus: () => true };
const asB = { headers: bearerFor(accountB), validateStatus: () => true };
const anonymous = { validateStatus: () => true };

let stub: Server;
const savedByA = new Set<string>();

async function listFor(config: typeof asA) {
  const response = await axios.get('/saved-homes?pageSize=100', config);
  expect(response.status).toBe(200);
  return savedHomesEnvelopeSchema.parse(response.data);
}

async function saveListing(listingId: string, config: typeof asA = asA) {
  const response = await axios.put(`/listings/${listingId}/saved`, undefined, config);
  expect(response.status).toBe(200);
  if (config === asA) savedByA.add(response.data.propertyId);
  return response.data as { propertyId: string; saved: boolean };
}

beforeAll(async () => {
  stub = await startIntrospectionStub();
  const probe = await axios.put(`/listings/${fixtures.sampleListingId}/saved`, undefined, asA);
  if (probe.status === 401) {
    throw new Error(
      'The service rejected the e2e credential. Start it with ' +
        `ACCOUNT_SERVICE_INTROSPECT_URL=${introspectionStubUrl()}`,
    );
  }
});

afterAll(async () => {
  for (const homeId of savedByA) {
    await axios.delete(`/saved-homes/${homeId}`, asA);
  }
  await stopIntrospectionStub(stub);
  await closePool();
});

describe('authentication', () => {
  it('answers 401 on every route for a signed-out caller, with the one body', async () => {
    const responses = await Promise.all([
      axios.put(`/listings/${fixtures.sampleListingId}/saved`, undefined, anonymous),
      axios.delete(`/listings/${fixtures.sampleListingId}/saved`, anonymous),
      axios.delete(`/saved-homes/${randomUUID()}`, anonymous),
      axios.get('/saved-homes', anonymous),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.data).toEqual(UNAUTHENTICATED_BODY);
    }
  });

  it('answers 401 for an unknown credential', async () => {
    const response = await axios.get('/saved-homes', {
      headers: { Authorization: 'Bearer not-a-session' },
      validateStatus: () => true,
    });
    expect(response.status).toBe(401);
  });
});

describe('save and unsave', () => {
  it('saves once however often it is called, and the list carries one row', async () => {
    const first = await saveListing(fixtures.sampleListingId);
    const second = await saveListing(fixtures.sampleListingId);

    expect(first.saved).toBe(true);
    expect(idSchema.safeParse(first.propertyId).success).toBe(true);
    expect(second.propertyId).toBe(first.propertyId);
    const list = await listFor(asA);
    expect(list.results.filter((home) => home.propertyId === first.propertyId)).toHaveLength(1);
    expect(
      list.results.find((home) => home.propertyId === first.propertyId)?.savedFromListingId,
    ).toBe(fixtures.sampleListingId);
  });

  it('never lets another account read or remove the save', async () => {
    const { propertyId } = await saveListing(fixtures.sampleListingId);

    expect((await listFor(asB)).results.map((home) => home.propertyId)).not.toContain(propertyId);

    const removal = await axios.delete(`/saved-homes/${propertyId}`, asB);
    expect(removal.status).toBe(200);
    expect(removal.data.saved).toBe(false);
    expect((await listFor(asA)).results.map((home) => home.propertyId)).toContain(propertyId);
  });

  it('unsaves by home id and by listing, and both are a success when nothing is saved', async () => {
    const { propertyId } = await saveListing(fixtures.sampleListingId);

    const byHome = await axios.delete(`/saved-homes/${propertyId}`, asA);
    const again = await axios.delete(`/listings/${fixtures.sampleListingId}/saved`, asA);

    expect(byHome.data).toEqual({ propertyId, saved: false });
    expect(again.status).toBe(200);
    expect((await listFor(asA)).results.map((home) => home.propertyId)).not.toContain(propertyId);
  });

  it('answers the one frozen 404 for an unknown listing and for a withheld listing', async () => {
    const unknown = await axios.put(`/listings/${randomUUID()}/saved`, undefined, asA);
    const withheld = await axios.put(
      `/listings/${fixtures.suppressedListingId}/saved`,
      undefined,
      asA,
    );

    expect(unknown.status).toBe(404);
    expect(unknown.data).toEqual(NOT_FOUND_BODY);
    expect(withheld.status).toBe(404);
    expect(withheld.data).toEqual(unknown.data);
  });
});

describe('home-shaped list', () => {
  it('returns an off-market home as a normal row with a null listing', async () => {
    const withdrawn = fixtures.nonConsumerStatusListingIds.Withdrawn;
    const { propertyId } = await saveListing(withdrawn);

    const home = (await listFor(asA)).results.find((row) => row.propertyId === propertyId);

    expect(home).toBeDefined();
    expect(home?.listing).toBeNull();
    expect(home?.marketStatus).toBe('Off market');
    expect(home?.property.city).toBeTruthy();
  });

  it('keeps a saved home in the list after its listing is deleted, never a 500', async () => {
    const listingId = fixtures.landParcelListingId;
    const { propertyId } = await saveListing(listingId);
    const pool = getPool();
    await pool.query('UPDATE listings SET deleted_at = now() WHERE id = $1', [listingId]);
    try {
      const response = await axios.get('/saved-homes?pageSize=100', asA);
      expect(response.status).toBe(200);
      const home = savedHomesEnvelopeSchema
        .parse(response.data)
        .results.find((row) => row.propertyId === propertyId);
      expect(home?.listing).toBeNull();
      expect(home?.property.address).toBeNull();
      expect(home?.marketStatus).toBe('Off market');
    } finally {
      await pool.query('UPDATE listings SET deleted_at = NULL WHERE id = $1', [listingId]);
    }
  });

  it('applies the view masking to a home whose listing withheld the address', async () => {
    const { propertyId } = await saveListing(fixtures.suppressedAddressListingId);

    const response = await axios.get('/saved-homes?pageSize=100', asA);
    const list = savedHomesEnvelopeSchema.parse(response.data);
    const home = list.results.find((row) => row.propertyId === propertyId);

    expect(home).toBeDefined();
    expect(home?.property.address).toBeNull();
    expect(home?.property.unitNumber).toBeNull();
    expect(home?.listing?.address ?? null).toBeNull();
    expect(home?.listing?.latitude ?? null).toBeNull();
    const serialised = JSON.stringify(home);
    expect(
      payloadLeaksAddress(
        serialised,
        fixtures.suppressedAddressStreetLine,
        fixtures.suppressedAddressStreetSlug,
      ),
    ).toBe(false);
    expect(serialised).not.toContain(String(fixtures.suppressedAddressLatitude));
    expect(serialised).not.toContain(fixtures.suppressedAddressUnitNumber);
  });

  it('rejects an unknown query parameter with 400', async () => {
    const response = await axios.get('/saved-homes?fields=id', asA);
    expect(response.status).toBe(400);
  });
});

describe('saved state on the existing read paths', () => {
  it('adds isSaved to the detail of a signed-in caller, by home, and keeps it private', async () => {
    const { propertyId } = await saveListing(fixtures.sampleListingId);

    const mine = await axios.get(`/listings/${fixtures.sampleListingId}`, asA);
    const theirs = await axios.get(`/listings/${fixtures.sampleListingId}`, asB);

    expect(mine.data.listing.propertyId).toBe(propertyId);
    expect(mine.data.listing.isSaved).toBe(true);
    expect(mine.data.listing.isFavorited).toBe(true);
    expect(mine.headers['cache-control']).toBe('private, no-store');
    expect(theirs.data.listing.isSaved).toBe(false);
  });

  it('omits the flags and keeps the public cache for a signed-out caller, never an error', async () => {
    await saveListing(fixtures.sampleListingId);

    const response = await axios.get(`/listings/${fixtures.sampleListingId}`, anonymous);

    expect(response.status).toBe(200);
    expect(response.data.listing).not.toHaveProperty('isSaved');
    expect(response.headers['cache-control']).toBe('public, max-age=60');
  });

  it('adds a boolean flag to every search row of a signed-in caller', async () => {
    const { propertyId } = await saveListing(fixtures.sampleListingId);

    const response = await axios.get('/listings?pageSize=100', asA);

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    for (const row of response.data.results) {
      expect(typeof row.isSaved).toBe('boolean');
      if (row.propertyId === propertyId) expect(row.isSaved).toBe(true);
    }
  });

  it('serves a signed-out search with no flags and the public cache', async () => {
    const response = await axios.get('/listings?pageSize=100', anonymous);

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=60');
    for (const row of response.data.results) {
      expect(row).not.toHaveProperty('isSaved');
    }
  });
});
