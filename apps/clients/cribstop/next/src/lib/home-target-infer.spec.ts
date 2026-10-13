import { inferHomeTarget, prefersRentFirst, radiusForConfidence } from './home-target';

const NOW = Date.UTC(2026, 9, 13);
const DAY = 24 * 60 * 60 * 1000;
const dc = { city: 'Washington', state: 'DC' };
const rich = { city: 'Richmond', state: 'VA' };
const bal = { city: 'Baltimore', state: 'MD' };
const ash = { city: 'Ashburn', state: 'VA' };
const markets = [dc, { city: 'Rockville', state: 'MD' }, { city: 'Arlington', state: 'VA' }];
const ago = (days: number) => NOW - days * DAY;

describe('inferHomeTarget', () => {
  it('keeps explicit and a fresh search as the high-confidence path', () => {
    const t = inferHomeTarget({
      explicit: dc,
      lastSearch: { ...rich, searchedAt: NOW },
      savedPlaces: [bal, bal, bal],
      now: NOW,
    });
    expect(t).toMatchObject({ ...dc, source: 'explicit', confidence: 1, radiusKm: 8 });
    const s = inferHomeTarget({
      lastSearch: { ...rich, searchedAt: NOW - DAY },
      savedPlaces: [{ ...bal, at: NOW }],
      now: NOW,
    });
    expect(s).toMatchObject({ ...rich, source: 'last-search' });
  });

  it('halves a search weight every 14 days', () => {
    const t = inferHomeTarget({ lastSearch: { ...rich, searchedAt: ago(14) }, now: NOW });
    expect(t?.confidence).toBeCloseTo(0.5);
    expect(t?.radiusKm).toBe(20);
  });

  it('ranks looking-for above one save and above the IP region', () => {
    expect(
      inferHomeTarget({ lookingFor: dc, savedPlaces: [{ ...rich, at: NOW }], ip: ash, now: NOW }),
    ).toMatchObject({ ...dc, source: 'looking-for' });
  });

  it('sums saves of one place and decays them over 30 days', () => {
    const saves = [
      { ...rich, at: NOW },
      { ...rich, at: ago(30) },
    ];
    const t = inferHomeTarget({ savedPlaces: saves, ip: ash, now: NOW });
    expect(t).toMatchObject({ ...rich, source: 'saved-home' });
    expect(t?.confidence).toBeCloseTo(1);
  });

  it('caps view weight at 0.6 and lets a saved home outweigh many views', () => {
    const views = Array.from({ length: 10 }, () => ({ ...bal, at: NOW }));
    const only = inferHomeTarget({ viewedPlaces: views, now: NOW });
    expect(only).toMatchObject({ ...bal, source: 'viewed-homes', confidence: 0.6, radiusKm: 20 });
    const both = inferHomeTarget({
      viewedPlaces: views,
      savedPlaces: [{ ...rich, at: NOW }],
      now: NOW,
    });
    expect(both).toMatchObject({ ...rich, source: 'saved-home' });
  });

  it('uses only the newest 50 views', () => {
    const views = [
      ...Array.from({ length: 50 }, () => ({ ...bal, at: NOW })),
      ...Array.from({ length: 20 }, () => ({ ...rich, at: NOW })),
    ];
    expect(inferHomeTarget({ viewedPlaces: views, now: NOW })?.city).toBe('Baltimore');
  });

  it('decays views over 7 days and falls to the IP region', () => {
    const views = [{ ...bal, at: ago(28) }];
    expect(inferHomeTarget({ viewedPlaces: views, ip: ash, now: NOW })).toMatchObject({
      ...ash,
      source: 'ip',
      confidence: 0.3,
      radiusKm: null,
    });
  });

  it('ignores a stale search for precedence but keeps its small weight', () => {
    const stale = { ...rich, searchedAt: ago(60) };
    const t = inferHomeTarget({ lastSearch: stale, savedPlaces: [{ ...bal, at: NOW }], now: NOW });
    expect(t).toMatchObject({ ...bal, source: 'saved-home' });
  });

  it('maps confidence to radius', () => {
    expect(radiusForConfidence(0.8)).toBe(8);
    expect(radiusForConfidence(0.79)).toBe(20);
    expect(radiusForConfidence(0.4)).toBe(20);
    expect(radiusForConfidence(0.39)).toBeNull();
  });

  it('rotates the licensed markets per load when there is no signal', () => {
    const at = (loadIndex: number) => inferHomeTarget({ markets, loadIndex, now: NOW });
    expect(at(0)).toMatchObject({ ...dc, source: 'rotation', confidence: 0, radiusKm: null });
    expect(at(1)?.city).toBe('Rockville');
    expect(at(2)?.city).toBe('Arlington');
    expect(at(3)?.city).toBe('Washington');
  });

  it('returns null with no signal and no market', () => {
    expect(inferHomeTarget({ now: NOW })).toBeNull();
  });

  it('ignores an item with no place', () => {
    const t = inferHomeTarget({
      viewedPlaces: [{ city: '', state: '', at: NOW }],
      markets,
      now: NOW,
    });
    expect(t?.source).toBe('rotation');
  });
});

describe('same-visit refinement (flagged bet)', () => {
  const visitStart = NOW - 60_000;
  const visit = [
    { ...bal, at: NOW - 1000 },
    { ...bal, at: NOW - 2000 },
  ];

  it('moves the target after 2 views in this visit, with no account', () => {
    const t = inferHomeTarget({
      lastSearch: { ...rich, searchedAt: NOW },
      viewedPlaces: visit,
      visitStart,
      sameVisitRefine: true,
      now: NOW,
    });
    expect(t).toMatchObject({ ...bal, source: 'visit-views', confidence: 1, radiusKm: 8 });
  });

  it('does nothing with the flag off', () => {
    const t = inferHomeTarget({
      lastSearch: { ...rich, searchedAt: NOW },
      viewedPlaces: visit,
      visitStart,
      sameVisitRefine: false,
      now: NOW,
    });
    expect(t).toMatchObject({ ...rich, source: 'last-search' });
  });

  it('needs 2 views and never beats an explicit search', () => {
    const base = { visitStart, sameVisitRefine: true, now: NOW, lastSearch: rich };
    expect(inferHomeTarget({ ...base, viewedPlaces: [visit[0]] })?.source).toBe('last-search');
    expect(inferHomeTarget({ ...base, explicit: dc, viewedPlaces: visit })?.source).toBe(
      'explicit',
    );
  });

  it('ignores views from before this visit', () => {
    const old = visit.map((v) => ({ ...v, at: visitStart - DAY }));
    const t = inferHomeTarget({
      lastSearch: { ...rich, searchedAt: NOW },
      viewedPlaces: old,
      visitStart,
      sameVisitRefine: true,
      now: NOW,
    });
    expect(t?.source).toBe('last-search');
  });
});

describe('prefersRentFirst', () => {
  it('is true for a rent last search', () => {
    expect(prefersRentFirst({ lastSearchSide: 'rent', now: NOW })).toBe(true);
  });
  it('is true when most views in 7 days are rent', () => {
    const views = [
      { side: 'rent' as const, at: ago(1) },
      { side: 'rent' as const, at: ago(2) },
      { side: 'sale' as const, at: ago(3) },
      { side: 'sale' as const, at: ago(20) },
      { side: 'sale' as const, at: ago(21) },
    ];
    expect(prefersRentFirst({ views, now: NOW })).toBe(true);
  });
  it('is false with no signal or mostly sale views', () => {
    expect(prefersRentFirst({ now: NOW })).toBe(false);
    expect(
      prefersRentFirst({
        views: [
          { side: 'sale', at: ago(1) },
          { side: 'rent', at: ago(1) },
        ],
        now: NOW,
      }),
    ).toBe(false);
  });
});
