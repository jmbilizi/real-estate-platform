/** @jest-environment node */
import type { ListingCardRow } from '@cribstop/property-contracts';
import {
  AI_SEARCH_BOTS,
  AI_TRAINING_BOTS,
  chunk,
  chunkCount,
  isIndexableOrigin,
  isSitemapEligible,
  llmsTxtFor,
  PRODUCTION_ORIGIN,
  robotsFor,
  SITEMAP_CHUNK_SIZE,
} from './site-indexing';
import {
  allEntries,
  placeEntries,
  sitemapChunk,
  sitemapChunkIds,
  sitemapIndexXml,
} from './sitemap-entries';

function card(over: Partial<ListingCardRow> = {}): ListingCardRow {
  return {
    id: 'a1',
    propertyPath: '/property/1-main-st-reston-va/a1',
    address: '1 Main St',
    isSample: false,
    status: 'Active',
    lastUpdated: '2026-09-01T12:00:00.000Z',
    ...over,
  } as ListingCardRow;
}

describe('robotsFor', () => {
  it('allows crawling and names the sitemap index on the production origin', () => {
    const robots = robotsFor(PRODUCTION_ORIGIN);
    expect(robots.sitemap).toBe(`${PRODUCTION_ORIGIN}/sitemap-index.xml`);
    const rules = robots.rules as { userAgent: string | string[]; disallow: string[] }[];
    const disallow = rules[0].disallow;
    expect(rules[0].userAgent).toBe('*');
    expect(disallow).toEqual(
      expect.arrayContaining([
        '/api/',
        '/admin',
        '/agent',
        '/login',
        '/signup',
        '/forgot-password',
        '/secure-account',
      ]),
    );
  });

  it('gives search bots every `*` disallow and no /property/ block', () => {
    const rules = robotsFor(PRODUCTION_ORIGIN).rules as {
      userAgent: string[];
      disallow: string[];
    }[];
    const group = rules.find((r) => r.userAgent.includes('OAI-SearchBot'));
    expect(group?.userAgent).toEqual([...AI_SEARCH_BOTS]);
    expect(group?.userAgent).toEqual(
      expect.arrayContaining(['Claude-SearchBot', 'PerplexityBot', 'ChatGPT-User', 'Claude-User']),
    );
    expect(group?.disallow).toEqual(rules[0].disallow);
    expect(group?.disallow).not.toContain('/property/');
  });

  it('blocks training bots on /property/ and repeats every `*` disallow', () => {
    const rules = robotsFor(PRODUCTION_ORIGIN).rules as {
      userAgent: string[];
      allow: string;
      disallow: string[];
    }[];
    const group = rules.find((r) => r.userAgent.includes('GPTBot'));
    expect(group?.userAgent).toEqual([...AI_TRAINING_BOTS]);
    expect(group?.allow).toBe('/');
    expect(group?.disallow).toEqual(expect.arrayContaining([...rules[0].disallow, '/property/']));
  });

  it.each([
    ['dev', 'https://dev.cribstop.com'],
    ['test', 'https://test.cribstop.com'],
    ['look-alike', 'https://cribstop.com.evil.example'],
    ['unset', null],
  ])('disallows everything on %s', (_name, origin) => {
    expect(robotsFor(origin)).toEqual({ rules: { userAgent: '*', disallow: '/' } });
  });

  it('tolerates a trailing slash on the production origin', () => {
    expect(isIndexableOrigin(`${PRODUCTION_ORIGIN}/`)).toBe(true);
  });
});

describe('llmsTxtFor', () => {
  it('describes the brand, area and sitemap index, and lists no listing URL', () => {
    const body = llmsTxtFor(PRODUCTION_ORIGIN) ?? '';
    expect(body).toMatch(/^# Cribstop/);
    expect(body).toContain('Real Broker, LLC');
    expect(body).toContain('MD, DC, and VA');
    expect(body).toContain(`${PRODUCTION_ORIGIN}/sitemap-index.xml`);
    expect(body).not.toContain('/property/');
  });

  it.each([['https://dev.cribstop.com'], ['https://cribstop.com.evil.example'], [null]])(
    'returns null off production (%s)',
    (origin) => {
      expect(llmsTxtFor(origin)).toBeNull();
    },
  );
});

describe('isSitemapEligible', () => {
  it('keeps Active, Coming Soon and Pending listings', () => {
    for (const status of ['Active', 'Coming Soon', 'Pending'] as const) {
      expect(isSitemapEligible(card({ status }))).toBe(true);
    }
  });

  it('drops a suppressed address, a sample and a sold listing', () => {
    expect(isSitemapEligible(card({ address: null }))).toBe(false);
    expect(isSitemapEligible(card({ isSample: true }))).toBe(false);
    expect(isSitemapEligible(card({ status: 'Sold' }))).toBe(false);
  });
});

describe('sitemap entries', () => {
  it('lists the home page and a listing with lastModified from the update time', () => {
    const entries = allEntries(PRODUCTION_ORIGIN, [card()]);
    expect(entries[0]).toEqual({ url: PRODUCTION_ORIGIN });
    expect(entries.at(-1)).toEqual({
      url: `${PRODUCTION_ORIGIN}/property/1-main-st-reston-va/a1`,
      lastModified: new Date('2026-09-01T12:00:00.000Z'),
    });
  });

  it('is empty off the production origin and without SITE_ORIGIN', () => {
    expect(allEntries('https://dev.cribstop.com', [card()])).toEqual([]);
    expect(allEntries(null, [card()])).toEqual([]);
  });

  it('chunks at 50,000 URLs', () => {
    expect(SITEMAP_CHUNK_SIZE).toBe(50_000);
    expect(chunkCount(0)).toBe(1);
    expect(chunkCount(50_000)).toBe(1);
    expect(chunkCount(50_001)).toBe(2);
    const items = Array.from({ length: 50_001 }, (_, i) => i);
    expect(chunk(items, 0)).toHaveLength(50_000);
    expect(chunk(items, 1)).toEqual([50_000]);
  });

  it('splits listings across chunk ids and the index lists each one', () => {
    const listings = Array.from({ length: 50_000 }, (_, i) => card({ id: `l${i}` }));
    const ids = sitemapChunkIds(PRODUCTION_ORIGIN, listings);
    expect(ids).toEqual([{ id: 0 }, { id: 1 }]);
    expect(sitemapChunk(PRODUCTION_ORIGIN, listings, 0)).toHaveLength(50_000);
    expect(sitemapChunk(PRODUCTION_ORIGIN, listings, 1).length).toBeGreaterThan(0);
    expect(sitemapIndexXml(PRODUCTION_ORIGIN, 2)).toContain(`${PRODUCTION_ORIGIN}/sitemap/1.xml`);
  });
});

describe('place entries (#845)', () => {
  const place = (over: Record<string, unknown> = {}) => ({
    city: 'Reston',
    state: 'VA',
    segment: 'homes-for-sale' as const,
    activeCount: 12,
    lastUpdated: '2026-10-01T08:00:00.000Z',
    ...over,
  });

  it('lists a city at or above the threshold with the newest listing update as lastmod', () => {
    expect(placeEntries(PRODUCTION_ORIGIN, [place()], 10)).toEqual([
      {
        url: `${PRODUCTION_ORIGIN}/reston-va/homes-for-sale`,
        lastModified: new Date('2026-10-01T08:00:00.000Z'),
      },
    ]);
    expect(placeEntries(PRODUCTION_ORIGIN, [place({ activeCount: 10 })], 10)).toHaveLength(1);
  });

  it('drops a city below the threshold, which its page marks noindex', () => {
    expect(placeEntries(PRODUCTION_ORIGIN, [place({ activeCount: 9 })], 10)).toEqual([]);
  });

  it('uses the rent path for a rent place', () => {
    const [entry] = placeEntries(PRODUCTION_ORIGIN, [place({ segment: 'homes-for-rent' })], 1);
    expect(entry?.url).toBe(`${PRODUCTION_ORIGIN}/reston-va/homes-for-rent`);
  });

  it('puts city pages between the static pages and the listings', () => {
    const entries = allEntries(PRODUCTION_ORIGIN, [card()], [place()]);
    expect(entries[0]).toEqual({ url: PRODUCTION_ORIGIN });
    expect(entries.map((entry) => entry.url)).toContain(
      `${PRODUCTION_ORIGIN}/reston-va/homes-for-sale`,
    );
    expect(entries.at(-1)?.url).toContain('/property/');
  });

  it('adds no city page off the production origin', () => {
    expect(allEntries('https://dev.cribstop.com', [], [place()])).toEqual([]);
  });
});
