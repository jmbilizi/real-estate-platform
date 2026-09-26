import type { Area } from '../../listings/on-demand';
import type { TrackedArea } from '../../listings/area-coverage-store';
import { type RefreshDeps, type RefreshFetchResult, runAreaRefresh } from './run-refresh';

const NOW = new Date('2026-09-26T12:00:00.000Z').getTime();
const HOUR = 60 * 60 * 1000;

function baseDeps(overrides: Partial<RefreshDeps> = {}): RefreshDeps {
  return {
    listTracked: () => Promise.resolve([]),
    parseArea: (key: string): Area => ({ city: key }),
    fetchWindow: () => Promise.resolve({ listingKeys: [], complete: true }),
    mapRecords: () => Promise.resolve({ published: 0 }),
    recordSuccess: () => Promise.resolve(),
    log: () => undefined,
    now: () => NOW,
    ...overrides,
  };
}

const OPTIONS = { intervalMs: 6 * HOUR, overlapMs: 5 * 60 * 1000, maxAreasPerRun: 25 };

describe('runAreaRefresh', () => {
  it('does nothing when no tracked area is due', async () => {
    const recordSuccess = jest.fn(() => Promise.resolve());
    const report = await runAreaRefresh(baseDeps({ recordSuccess }), OPTIONS);
    expect(report).toEqual({ areasDue: 0, refreshed: 0, capped: 0, failed: 0, recordsMapped: 0 });
    expect(recordSuccess).not.toHaveBeenCalled();
  });

  it('fetches, maps, and records success for a due area whose window completed', async () => {
    const tracked: TrackedArea[] = [
      { areaKey: 'frederick', sourceStatus: 'Active', syncedAt: new Date(NOW - 7 * HOUR) },
    ];
    const recordSuccess = jest.fn(() => Promise.resolve());
    const fetchWindow = jest.fn(
      (): Promise<RefreshFetchResult> => Promise.resolve({ listingKeys: ['1', '2'], complete: true }),
    );
    const mapRecords = jest.fn(() => Promise.resolve({ published: 2 }));

    const report = await runAreaRefresh(
      baseDeps({ listTracked: () => Promise.resolve(tracked), fetchWindow, mapRecords, recordSuccess }),
      OPTIONS,
    );

    expect(report).toEqual({ areasDue: 1, refreshed: 1, capped: 0, failed: 0, recordsMapped: 2 });
    expect(fetchWindow).toHaveBeenCalledWith(
      expect.objectContaining({ area: { city: 'frederick' }, sourceStatus: 'Active' }),
    );
    expect(mapRecords).toHaveBeenCalledWith(['1', '2']);
    expect(recordSuccess).toHaveBeenCalledWith('frederick', 'Active', expect.any(Date));
  });

  it('never maps when the window returned no records', async () => {
    const tracked: TrackedArea[] = [
      { areaKey: 'frederick', sourceStatus: 'Active', syncedAt: new Date(NOW - 7 * HOUR) },
    ];
    const mapRecords = jest.fn(() => Promise.resolve({ published: 0 }));
    await runAreaRefresh(
      baseDeps({
        listTracked: () => Promise.resolve(tracked),
        fetchWindow: () => Promise.resolve({ listingKeys: [], complete: true }),
        mapRecords,
      }),
      OPTIONS,
    );
    expect(mapRecords).not.toHaveBeenCalled();
  });

  it('leaves synced_at untouched and counts a capped window as capped, not refreshed', async () => {
    const tracked: TrackedArea[] = [
      { areaKey: 'frederick', sourceStatus: 'Active', syncedAt: new Date(NOW - 7 * HOUR) },
    ];
    const recordSuccess = jest.fn(() => Promise.resolve());
    const report = await runAreaRefresh(
      baseDeps({
        listTracked: () => Promise.resolve(tracked),
        fetchWindow: () => Promise.resolve({ listingKeys: ['1'], complete: false }),
        mapRecords: () => Promise.resolve({ published: 1 }),
        recordSuccess,
      }),
      OPTIONS,
    );
    expect(report.capped).toBe(1);
    expect(report.refreshed).toBe(0);
    expect(recordSuccess).not.toHaveBeenCalled();
  });

  it('counts a thrown fetch as failed and moves on without recording success', async () => {
    const tracked: TrackedArea[] = [
      { areaKey: 'frederick', sourceStatus: 'Active', syncedAt: new Date(NOW - 7 * HOUR) },
    ];
    const recordSuccess = jest.fn(() => Promise.resolve());
    const report = await runAreaRefresh(
      baseDeps({
        listTracked: () => Promise.resolve(tracked),
        fetchWindow: () => Promise.reject(new Error('Bright timed out')),
        recordSuccess,
      }),
      OPTIONS,
    );
    expect(report.failed).toBe(1);
    expect(recordSuccess).not.toHaveBeenCalled();
  });
});
