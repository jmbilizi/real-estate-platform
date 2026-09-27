import { parsePropertyPath } from '@cribstop/property-contracts';
import type { PoolClient } from 'pg';

import { createMemoryStore, createMockResoServer } from '../jobs/bright-ingest/mock-reso-server';
import { mapBrightPayloads } from '../jobs/bright-map/run';
import { buildAddressLookupUrl, createAddressLoader } from './address-loader';

jest.mock('../jobs/bright-map/run', () => ({
  loadListingStatuses: jest.fn(async () => []),
  mapBrightPayloads: jest.fn(async (_client: unknown, records: unknown[]) => ({
    report: { mapped: records.length },
    rejected: [],
  })),
}));

const TOKEN_ENDPOINT = 'https://okta.tst.brightmls.com/oauth2/default/v1/token';
const SERVICE_ROOT = 'https://bright-reso.tst.brightmls.com/RESO/OData/bright';
const ENV = {
  BRIGHT_MLS_ENV: 'test',
  BRIGHT_MLS_CLIENT_ID: 'fixture-client-id',
  BRIGHT_MLS_CLIENT_SECRET: 'fixture-client-secret',
};

const WITHDRAWN = {
  ListingKey: '3000001',
  ModificationTimestamp: '2026-09-20T10:00:00Z',
  StandardStatus: 'Withdrawn',
  // Production shape: UnparsedAddress can hold no street at all (probed 2026-09-26).
  UnparsedAddress: 'VA,ALEXANDRIA CITY',
  StreetNumber: '118',
  StreetName: 'BAGGETT',
  StreetSuffix: 'PLACE',
  PostalCode: '22314',
  City: 'ALEXANDRIA',
  StateOrProvince: 'VA',
};
const OTHER_STREET = {
  ...WITHDRAWN,
  ListingKey: '3000002',
  StreetName: 'KING',
  StreetSuffix: 'STREET',
};

function parsed(address: string) {
  const result = parsePropertyPath('alexandria-va', address);
  if (result === null) throw new Error('fixture path must parse');
  return result;
}

function fakeClient(): { client: PoolClient; statements: string[] } {
  const statements: string[] = [];
  const client = {
    query: async (text: string) => {
      statements.push(text);
      return { rows: [] };
    },
    release: () => undefined,
  } as unknown as PoolClient;
  return { client, statements };
}

function loader(records: Record<string, unknown>[], now = () => 0) {
  const server = createMockResoServer({
    tokenEndpoint: TOKEN_ENDPOINT,
    serviceRoot: SERVICE_ROOT,
    records: { BrightProperties: records },
  });
  const { client, statements } = fakeClient();
  const staging = createMemoryStore();
  const fetcher = createAddressLoader({
    env: ENV,
    fetchImpl: server.fetchImpl,
    stagingStore: staging.store,
    connect: async () => client,
    now,
    log: () => undefined,
  });
  return { fetcher, server, statements };
}

beforeEach(() => jest.mocked(mapBrightPayloads).mockClear());

describe('buildAddressLookupUrl', () => {
  it('filters by ZIP, StreetNumber and the first StreetName word, across all statuses', () => {
    const url = new URL(
      buildAddressLookupUrl(SERVICE_ROOT, parsed('118-baggett-place-alexandria-va-22314')),
    );
    expect(url.searchParams.get('$filter')).toBe(
      "PostalCode eq '22314' and StreetNumber eq '118' and startswith(tolower(StreetName),'baggett')",
    );
    expect(url.searchParams.get('$filter')).not.toContain('StandardStatus');
    expect(url.searchParams.get('$top')).toBe('50');
    expect(url.searchParams.get('$orderby')).toBeNull();
  });

  it('uses city and state when the path has no ZIP, and escapes a quote', () => {
    const result = parsePropertyPath('silver-spring-md', '9-o-neil-ct-silver-spring-md');
    if (result === null) throw new Error('fixture path must parse');
    const filter = new URL(buildAddressLookupUrl(SERVICE_ROOT, result)).searchParams.get('$filter');
    expect(filter).toBe(
      "City eq 'Silver Spring' and StateOrProvince eq 'MD' and StreetNumber eq '9' and " +
        "startswith(tolower(StreetName),'o')",
    );
  });
});

describe('createAddressLoader against the mock RESO server', () => {
  it('reads the address once and maps only the records Bright returned (hit)', async () => {
    const { fetcher, server, statements } = loader([WITHDRAWN, OTHER_STREET]);

    await fetcher.fetchAddress(parsed('118-baggett-place-alexandria-va-22314'));

    expect(server.pageRequests).toHaveLength(1);
    const mapped = jest.mocked(mapBrightPayloads).mock.calls[0]?.[1];
    expect(mapped).toEqual([WITHDRAWN]);
    expect(statements).toEqual(['BEGIN', 'COMMIT']);
  });

  it('maps nothing when Bright has no record at the address (miss)', async () => {
    const { fetcher, server } = loader([OTHER_STREET]);

    await fetcher.fetchAddress(parsed('118-baggett-place-alexandria-va-22314'));

    expect(server.pageRequests).toHaveLength(1);
    expect(mapBrightPayloads).not.toHaveBeenCalled();
  });

  it('reads one address at most once per cooldown, so a 404 cannot drive Bright traffic', async () => {
    const { fetcher, server } = loader([]);
    const path = parsed('118-baggett-place-alexandria-va');

    await fetcher.fetchAddress(path);
    await fetcher.fetchAddress(path);

    expect(server.pageRequests).toHaveLength(1);
  });

  it('does nothing when Bright is not configured', async () => {
    const fetcher = createAddressLoader({ env: {}, log: () => undefined });
    await expect(fetcher.fetchAddress(parsed('118-baggett-place-alexandria-va'))).resolves.toBe(
      undefined,
    );
    expect(mapBrightPayloads).not.toHaveBeenCalled();
  });
});
