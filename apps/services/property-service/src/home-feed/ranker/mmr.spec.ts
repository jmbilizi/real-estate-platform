import { officeOf, type Scored, selectRow, similarity } from './mmr';
import { candidate } from './test-helpers';

const scored = (c: ReturnType<typeof candidate>, score: number): Scored => ({
  candidate: c,
  score,
});

describe('similarity', () => {
  it('is 1 for the same building', () => {
    const a = candidate();
    const b = candidate({ propertyId: a.card.propertyId });
    expect(similarity(a.card, b.card)).toBe(1);
  });

  it('is 0.5 for the same ZIP, beds and a price within 10%', () => {
    const a = candidate({ price: 500000, beds: 3, zip: '22314' });
    const b = candidate({ price: 540000, beds: 3, zip: '22314' });
    expect(similarity(a.card, b.card)).toBe(0.5);
  });

  it('is 0 otherwise', () => {
    const a = candidate({ price: 500000, beds: 3 });
    expect(similarity(a.card, candidate({ price: 700000, beds: 3 }).card)).toBe(0);
    expect(similarity(a.card, candidate({ price: 500000, beds: 4 }).card)).toBe(0);
    expect(similarity(a.card, candidate({ price: 500000, beds: 3, zip: '20001' }).card)).toBe(0);
  });
});

describe('selectRow', () => {
  const noRandom = (): number => 0;

  it('caps a listing office at 2 cards per row', () => {
    const pool = Array.from({ length: 12 }, (_, i) =>
      scored(
        candidate({ officeName: 'Same Office', price: 100000 * (i + 1), zip: `2${i}000` }),
        1 - i / 100,
      ),
    );
    const row = selectRow(pool, 8, noRandom);
    expect(row).toHaveLength(2);
  });

  it('never shows two listings of one home in a row, explore slot included', () => {
    const a = candidate({ zip: '20001' });
    const twin = candidate({ propertyId: a.card.propertyId, zip: '20002' });
    const others = Array.from({ length: 10 }, (_, i) =>
      scored(candidate({ zip: `3${String(i).padStart(4, '0')}` }), 0.4),
    );
    const row = selectRow([scored(a, 0.9), scored(twin, 0.85), ...others], 8, () => 0);
    const homes = row.map((p) => p.item.candidate.card.propertyId);
    expect(new Set(homes).size).toBe(homes.length);
  });

  it('does not treat two missing ZIPs or beds as equal', () => {
    const a = candidate({ beds: null, price: 500000 });
    const b = candidate({ beds: null, price: 505000 });
    expect(similarity(a.card, b.card)).toBe(0);
  });

  it('does not cap a blank office name', () => {
    expect(officeOf(candidate({ officeName: '  ' }).card)).toBeNull();
  });

  it('prefers a diverse card over a near duplicate of a chosen one', () => {
    const a = candidate({ price: 500000, beds: 3, zip: '22314' });
    const near = candidate({ price: 505000, beds: 3, zip: '22314' });
    const far = candidate({ price: 900000, beds: 5, zip: '20001' });
    // near scores 0.80, far scores 0.70. lambda 0.7: near = 0.56 - 0.15 = 0.41, far = 0.49.
    const row = selectRow([scored(a, 0.9), scored(near, 0.8), scored(far, 0.7)], 2, noRandom);
    expect(row.map((p) => p.item.candidate.card.id)).toEqual([a.card.id, far.card.id]);
  });

  it('fills 1 slot in 8 with an exploration card', () => {
    const pool = Array.from({ length: 20 }, (_, i) =>
      scored(
        candidate({ price: 100000 + i * 90000, zip: `2${String(i).padStart(4, '0')}` }),
        1 - i / 100,
      ),
    );
    const row = selectRow(pool, 8, () => 0.99);
    expect(row).toHaveLength(8);
    expect(row.filter((p) => p.explore)).toHaveLength(1);
  });

  it('adds no exploration slot to a row shorter than 8', () => {
    const pool = Array.from({ length: 5 }, (_, i) =>
      scored(candidate({ zip: `2${String(i).padStart(4, '0')}` }), 0.5),
    );
    const row = selectRow(pool, 8, noRandom);
    expect(row.some((p) => p.explore)).toBe(false);
  });
});
