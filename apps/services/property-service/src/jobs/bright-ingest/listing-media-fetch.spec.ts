import type { FetchLike } from './bright-client';
import {
  buildListingMediaFilter,
  fetchListingMedia,
  resetRefusedMediaFilters,
} from './listing-media-fetch';
import { createMemoryStore } from './mock-reso-server';

const SERVICE_ROOT = 'https://bright-reso.tst.brightmls.com/RESO/OData/bright';
const HOST = 'bright-reso.tst.brightmls.com';
const tokenProvider = () =>
  Promise.resolve({ accessToken: 'fixture-token', expiresInSeconds: 3600 });

function respond(status: number, body: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Bad Request',
    headers: { get: () => null },
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

function run(memory: ReturnType<typeof createMemoryStore>, fetchImpl: FetchLike) {
  return fetchListingMedia({
    serviceRoot: SERVICE_ROOT,
    serviceRootHost: HOST,
    tokenProvider,
    store: memory.store,
    feedTier: 'production',
    runId: 'run-1',
    listing: { listingKey: '100', listingId: "MD'100" },
    pageOptions: { fetchImpl, maxRetries: 0 },
  });
}

beforeEach(() => resetRefusedMediaFilters());

describe('buildListingMediaFilter', () => {
  it('filters an Int64 key bare and a string id quoted, quotes doubled', () => {
    const listing = { listingKey: '100', listingId: "MD'100" };
    expect(buildListingMediaFilter('ResourceRecordKey', listing)).toBe('ResourceRecordKey eq 100');
    expect(buildListingMediaFilter('ListingId', listing)).toBe("ListingId eq 'MD''100'");
  });
});

describe('fetchListingMedia', () => {
  it('stages the listing gallery and drops a photo the feed no longer returns', async () => {
    const memory = createMemoryStore();
    memory.rows.set('BrightMedia\u00009', {
      modifiedAt: '2026-09-01T00:00:00.000Z',
      payload: { MediaKey: 9, ResourceRecordKey: 100 },
      runId: 'run-0',
    });
    const urls: string[] = [];
    const fetchImpl: FetchLike = (url) => {
      urls.push(url);
      return respond(200, {
        value: [
          { MediaKey: 7, ResourceRecordKey: 100 },
          { MediaKey: 8, ResourceRecordKey: 100 },
        ],
      });
    };

    const result = await run(memory, fetchImpl);

    expect(result).toEqual({ kind: 'staged', filter: 'ResourceRecordKey', photos: 2 });
    // %20, never `+`: see buildListingMediaUrl.
    expect(urls[0]).toContain('BrightMedia?$filter=ResourceRecordKey%20eq%20100');
    expect(memory.rows.has('BrightMedia\u00007')).toBe(true);
    expect(memory.rows.has('BrightMedia\u00009')).toBe(false);
  });

  it('falls back to ListingId when Bright refuses the key filter, and remembers the refusal', async () => {
    const memory = createMemoryStore();
    const urls: string[] = [];
    const fetchImpl: FetchLike = (url) => {
      urls.push(url);
      return url.includes('ListingId')
        ? respond(200, { value: [{ MediaKey: 5, ResourceRecordKey: 100 }] })
        : respond(400, {});
    };

    await expect(run(memory, fetchImpl)).resolves.toMatchObject({ filter: 'ListingId' });
    for (let i = 0; i < 4; i += 1) {
      await run(memory, fetchImpl);
    }

    // Each key form is retried until its third refusal in a row, then skipped: 2 forms x 3.
    expect(urls.filter((url) => url.includes('ResourceRecordKey'))).toHaveLength(6);
  });

  it('reports unsupported when every filter is refused', async () => {
    await expect(run(createMemoryStore(), () => respond(400, {}))).resolves.toEqual({
      kind: 'unsupported',
    });
  });
});
