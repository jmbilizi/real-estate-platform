import { applyInChunks, MAX_PACE_REST_MS, mergePageResults } from './apply-chunks';
import type { PageResult } from './sync';

const result = (overrides: Partial<PageResult> = {}): PageResult => ({
  staged: 1,
  mapped: 1,
  published: 1,
  withheld: 0,
  takenDown: 0,
  withheldByReason: {},
  ...overrides,
});

const records = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ ListingKey: `${i}` }));

describe('applyInChunks (#755)', () => {
  it('applies a slice in chunks of the given size, in order', async () => {
    const sizes: number[] = [];

    await applyInChunks(
      records(10),
      (chunk) => {
        sizes.push(chunk.length);
        return Promise.resolve(result());
      },
      { chunkSize: 4, paceRatio: 0 },
    );

    expect(sizes).toEqual([4, 4, 2]);
  });

  it('adds the counts of every chunk', async () => {
    const merged = await applyInChunks(
      records(3),
      () => Promise.resolve(result({ withheld: 1, withheldByReason: { 'no-address': 1 } })),
      { chunkSize: 1, paceRatio: 0 },
    );

    expect(merged).toMatchObject({ staged: 3, mapped: 3, published: 3, withheld: 3 });
    expect(merged.withheldByReason).toEqual({ 'no-address': 3 });
  });

  it('rests after each chunk for the ratio times the chunk duration', async () => {
    let clock = 0;
    const rests: number[] = [];

    await applyInChunks(
      records(2),
      () => {
        clock += 400;
        return Promise.resolve(result());
      },
      {
        chunkSize: 1,
        paceRatio: 2,
        now: () => clock,
        sleep: (ms) => {
          rests.push(ms);
          clock += ms;
          return Promise.resolve();
        },
      },
    );

    expect(rests).toEqual([800, 800]);
  });

  it('never rests when the ratio is 0', async () => {
    const sleep = jest.fn(() => Promise.resolve());

    await applyInChunks(records(3), () => Promise.resolve(result()), {
      chunkSize: 1,
      paceRatio: 0,
      sleep,
    });

    expect(sleep).not.toHaveBeenCalled();
  });

  it('caps one rest', async () => {
    let clock = 0;
    const rests: number[] = [];

    await applyInChunks(
      records(1),
      () => {
        clock += 60_000;
        return Promise.resolve(result());
      },
      {
        chunkSize: 1,
        paceRatio: 1,
        now: () => clock,
        sleep: (ms) => {
          rests.push(ms);
          return Promise.resolve();
        },
      },
    );

    expect(rests).toEqual([MAX_PACE_REST_MS]);
  });

  it('stops at the first failed chunk and leaves the rest unwritten', async () => {
    const applied: number[] = [];

    await expect(
      applyInChunks(
        records(6),
        (chunk) => {
          applied.push(chunk.length);
          return applied.length === 2
            ? Promise.reject(new Error('deadlock'))
            : Promise.resolve(result());
        },
        { chunkSize: 2, paceRatio: 0 },
      ),
    ).rejects.toThrow('deadlock');

    expect(applied).toEqual([2, 2]);
  });
});

describe('mergePageResults (#755)', () => {
  it('sums the optional suppression counts', () => {
    const merged = mergePageResults([
      result({ suppressedByFlag: { price: 2 } }),
      result({ suppressedByFlag: { price: 1, media: 4 } }),
    ]);

    expect(merged.suppressedByFlag).toEqual({ price: 3, media: 4 });
  });
});
