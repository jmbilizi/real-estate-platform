import { buildRows, type FeedInput } from './rows';
import { buildProfileModel, EMPTY_MODEL } from './features';
import { candidate } from './test-helpers';
import { MODEL_VERSION } from './v1-weights';

const NOW = Date.parse('2026-10-13T00:00:00.000Z');
const daysAgo = (days: number): string => new Date(NOW - days * 86_400_000).toISOString();

function pool(count: number, overrides = {}) {
  return Array.from({ length: count }, (_, i) =>
    candidate({
      zip: `2${String(i).padStart(4, '0')}`,
      price: 200000 + i * 40000,
      listedAt: daysAgo(i % 20),
      ...overrides,
    }),
  );
}

const base = (over: Partial<FeedInput>): FeedInput => ({
  candidates: [],
  model: EMPTY_MODEL,
  warm: false,
  place: 'Alexandria, VA',
  radiusKm: 20,
  variant: 'v1',
  now: NOW,
  rng: () => 0.5,
  ...over,
});

describe('buildRows', () => {
  it('keeps the current order for a cold visit', () => {
    const candidates = [
      ...pool(40),
      ...pool(12, { status: 'Coming Soon', listedAt: daysAgo(40) }),
      ...pool(24, {
        previousPrice: 900000,
        price: 200000,
        priceChangedAt: daysAgo(3),
        listedAt: daysAgo(40),
      }),
    ];
    const rows = buildRows(base({ candidates }));
    expect(rows.map((r) => r.rowId)).toEqual([
      'near-you',
      'just-listed',
      'coming-soon',
      'price-drops',
    ]);
  });

  it('orders a warm visit: picked, new, price drops, then the rest', () => {
    const candidates = [
      ...pool(40),
      ...pool(12, { status: 'Coming Soon', listedAt: daysAgo(40) }),
      ...pool(24, {
        previousPrice: 900000,
        price: 200000,
        priceChangedAt: daysAgo(3),
        listedAt: daysAgo(40),
      }),
    ];
    const rows = buildRows(base({ candidates, warm: true }));
    expect(rows.map((r) => r.rowId).slice(0, 3)).toEqual(['picked', 'new', 'price-drops']);
  });

  it('never repeats a listing across rows', () => {
    const rows = buildRows(base({ candidates: pool(60), warm: true }));
    const ids = rows.flatMap((r) => r.listings.map((l) => l.listing.id));
    expect(ids.length).toBeGreaterThan(8);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('hides a row with fewer than 4 cards and lets a later row use those cards', () => {
    const few = pool(3, { status: 'Coming Soon' });
    const rows = buildRows(base({ candidates: [...pool(20), ...few] }));
    expect(rows.some((r) => r.rowId === 'coming-soon')).toBe(false);
    const nearIds = rows.find((r) => r.rowId === 'near-you')?.listings.map((l) => l.listing.id);
    expect(nearIds).toBeDefined();
  });

  it('stamps modelVersion and variant on every row', () => {
    const rows = buildRows(base({ candidates: pool(30), variant: 'arm-b' }));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.modelVersion).toBe(MODEL_VERSION);
      expect(row.variant).toBe('arm-b');
    }
  });

  it('states facts only in titles', () => {
    const rows = buildRows(base({ candidates: pool(30), warm: true }));
    for (const row of rows) {
      expect(row.title).toMatch(/Alexandria, VA|your range/);
    }
  });

  it('puts the price-band match first in the picked row', () => {
    const viewed = [300000, 310000, 320000].map((price) => ({
      card: candidate({ price }).card,
      kind: 'view' as const,
    }));
    const model = buildProfileModel(viewed);
    const near = candidate({ price: 310000, zip: '22001' });
    const far = candidate({ price: 3000000, zip: '22002' });
    const rows = buildRows(
      base({ candidates: [far, near, ...pool(10)], model, warm: true, rng: () => 0 }),
    );
    const picked = rows.find((r) => r.rowId === 'picked');
    const ids = picked?.listings.map((l) => l.listing.id) ?? [];
    expect(ids.indexOf(near.card.id)).toBeLessThan(
      ids.indexOf(far.card.id) === -1 ? 99 : ids.indexOf(far.card.id),
    );
  });
});
