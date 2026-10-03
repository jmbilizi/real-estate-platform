import { layoutPricePills, PILL_BOX_H, pillWidth, type PinPoint } from './map-pins';

const view = { width: 400, height: 700, pad: 60 };
const at = (id: string, x: number, y: number, label = '$585K'): PinPoint => ({ id, x, y, label });

describe('pillWidth', () => {
  it('never goes below the 44px tap target', () => {
    expect(pillWidth('$9')).toBe(44);
    expect(PILL_BOX_H).toBe(44);
  });

  it('grows with the label', () => {
    expect(pillWidth('$2.1K/mo')).toBeGreaterThan(pillWidth('$585K'));
  });
});

describe('layoutPricePills (#546)', () => {
  it('gives a lone pin a pill', () => {
    expect([...layoutPricePills([at('a', 100, 200)], view)]).toEqual(['a']);
  });

  it('keeps the higher-priority pill whole and turns the overlapping one into a dot', () => {
    const pills = layoutPricePills([at('first', 100, 200), at('second', 110, 205)], view);
    expect(pills.has('first')).toBe(true);
    expect(pills.has('second')).toBe(false);
  });

  it('lets two clear pills both stay whole', () => {
    const pills = layoutPricePills([at('a', 60, 200), at('b', 300, 200)], view);
    expect([...pills].sort()).toEqual(['a', 'b']);
  });

  it('treats the pill as the box above the tail tip, so a pin straight below stays whole', () => {
    // The first pill spans y 165..200. A pin 60px lower has its own box at 205..240.
    const pills = layoutPricePills([at('a', 100, 200), at('b', 100, 260)], view);
    expect(pills.size).toBe(2);
  });

  it('turns a pin far outside the viewport into a dot without a pill', () => {
    const pills = layoutPricePills([at('away', 2000, 200), at('near', 100, 200)], view);
    expect([...pills]).toEqual(['near']);
  });

  it('never returns more pills than input points, and never drops the first point', () => {
    const points = Array.from({ length: 2000 }, (_, i) =>
      at(`p${i}`, (i * 7) % 400, (i * 13) % 700),
    );
    const pills = layoutPricePills(points, view);
    expect(pills.has('p0')).toBe(true);
    expect(pills.size).toBeLessThan(points.length);
  });

  it('keeps every pill clear of every other pill', () => {
    const points = Array.from({ length: 600 }, (_, i) =>
      at(`p${i}`, (i * 37) % 400, 40 + ((i * 53) % 640), i % 2 ? '$1.2M' : '$585K'),
    );
    const pills = layoutPricePills(points, view);
    const boxes = points
      .filter((p) => pills.has(p.id))
      .map((p) => ({
        l: p.x - pillWidth(p.label) / 2,
        r: p.x + pillWidth(p.label) / 2,
        t: p.y - 35,
        b: p.y,
      }));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const overlap = a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
        expect(overlap).toBe(false);
      }
    }
  });

  it('is deterministic for the same input order', () => {
    const points = [at('a', 100, 200), at('b', 105, 202), at('c', 300, 400)];
    expect([...layoutPricePills(points, view)]).toEqual([...layoutPricePills(points, view)]);
  });
});
