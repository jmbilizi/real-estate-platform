import { fetchGateway } from '@/app/api/_lib/gateway';
import { loadNeighborhoodSections } from './neighborhoods-server';

jest.mock('@/app/api/_lib/gateway', () => ({ fetchGateway: jest.fn() }));
const mockedFetch = fetchGateway as jest.Mock;

function row(i: number, state: string, city = 'City') {
  return {
    name: `N${i}`,
    city,
    state,
    slug: `n${i}`,
    total: 9,
    sale: 5,
    rent: 4,
  };
}

function ok(rows: unknown[]) {
  return { ok: true, status: 200, json: async () => ({ results: rows, total: rows.length }) };
}

/** Answers by the `state` and `city` query params of the requested path. */
function answer(by: (state: string | null, city: string | null) => unknown) {
  mockedFetch.mockImplementation(async (path: string) => {
    const q = new URL(path, 'http://x').searchParams;
    return by(q.get('state'), q.get('city'));
  });
}

beforeEach(() => mockedFetch.mockReset());

describe('loadNeighborhoodSections', () => {
  it('requests every licensed state with limit 100 and minCount 5, in brand order', async () => {
    answer((state) => ok([row(1, state as string)]));
    const sections = await loadNeighborhoodSections({ kind: 'all' });
    expect(sections.map((s) => s.key)).toEqual(['MD', 'DC', 'VA']);
    const paths = mockedFetch.mock.calls.map((c) => c[0] as string);
    expect(paths).toHaveLength(3);
    for (const p of paths) {
      expect(p).toContain('/property/listings/neighborhoods?');
      expect(p).toContain('limit=100');
      expect(p).toContain('minCount=5');
    }
  });

  it('keeps the other states when one request fails', async () => {
    answer((state) =>
      state === 'DC' ? { ok: false, status: 502, json: async () => ({}) } : ok([row(1, state!)]),
    );
    const sections = await loadNeighborhoodSections({ kind: 'all' });
    expect(sections.map((s) => s.key)).toEqual(['MD', 'VA']);
  });

  it('keeps the other states when one request throws or returns a bad body', async () => {
    mockedFetch.mockImplementation(async (path: string) => {
      const state = new URL(path, 'http://x').searchParams.get('state');
      if (state === 'MD') throw new Error('timeout');
      if (state === 'DC') return { ok: true, status: 200, json: async () => ({ nope: 1 }) };
      return ok([row(1, 'VA')]);
    });
    const sections = await loadNeighborhoodSections({ kind: 'all' });
    expect(sections.map((s) => s.key)).toEqual(['VA']);
  });

  it('returns no sections when every request fails or is empty', async () => {
    answer(() => ({ ok: false, status: 500, json: async () => ({}) }));
    expect(await loadNeighborhoodSections({ kind: 'all' })).toEqual([]);
    answer(() => ok([]));
    expect(await loadNeighborhoodSections({ kind: 'state', state: 'MD' })).toEqual([]);
  });

  it('flags a state that returns exactly 100 rows', async () => {
    answer((state) =>
      ok(Array.from({ length: state === 'MD' ? 100 : 99 }, (_, i) => row(i, state!))),
    );
    const sections = await loadNeighborhoodSections({ kind: 'all' });
    expect(sections.map((s) => s.truncated)).toEqual([true, false, false]);
  });

  it('lists the city first and drops its neighborhoods from the rest of the state', async () => {
    answer((state, city) =>
      city ? ok([row(2, state!, 'Bethesda')]) : ok([row(1, state!), row(2, state!, 'Bethesda')]),
    );
    const sections = await loadNeighborhoodSections({
      kind: 'city',
      state: 'MD',
      city: 'Bethesda',
    });
    expect(sections.map((s) => s.heading)).toEqual(['Bethesda, MD', 'More in Maryland']);
    expect(sections[0]?.neighborhoods.map((n) => n.name)).toEqual(['N2']);
    expect(sections[1]?.neighborhoods.map((n) => n.name)).toEqual(['N1']);
  });

  it('shows the state alone when the city request fails', async () => {
    answer((state, city) =>
      city ? { ok: false, status: 500, json: async () => ({}) } : ok([row(1, state!)]),
    );
    const sections = await loadNeighborhoodSections({ kind: 'city', state: 'VA', city: 'X' });
    expect(sections.map((s) => s.key)).toEqual(['VA']);
  });
});
