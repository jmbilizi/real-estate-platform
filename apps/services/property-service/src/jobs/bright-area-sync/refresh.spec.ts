import type { TrackedArea } from '../../listings/area-coverage-store';
import { dueForRefresh } from './refresh';

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-09-26T12:00:00.000Z').getTime();

function area(overrides: Partial<TrackedArea> = {}): TrackedArea {
  return {
    areaKey: 'frederick||md',
    sourceStatus: 'Active',
    syncedAt: new Date(NOW - 6 * HOUR),
    ...overrides,
  };
}

describe('dueForRefresh', () => {
  it('skips an area synced more recently than the interval', () => {
    const rows = [area({ syncedAt: new Date(NOW - HOUR) })];
    expect(dueForRefresh(rows, NOW, 6 * HOUR, 5 * 60 * 1000, 25)).toEqual([]);
  });

  it('includes an area synced at least the interval ago', () => {
    const rows = [area({ syncedAt: new Date(NOW - 7 * HOUR) })];
    const windows = dueForRefresh(rows, NOW, 6 * HOUR, 5 * 60 * 1000, 25);
    expect(windows).toHaveLength(1);
    expect(windows[0]?.areaKey).toBe('frederick||md');
    expect(windows[0]?.sourceStatus).toBe('Active');
  });

  it('subtracts the overlap from the stored watermark to build modifiedAfter', () => {
    const syncedAt = new Date(NOW - 7 * HOUR);
    const overlapMs = 5 * 60 * 1000;
    const windows = dueForRefresh([area({ syncedAt })], NOW, 6 * HOUR, overlapMs, 25);
    expect(windows[0]?.modifiedAfter).toBe(new Date(syncedAt.getTime() - overlapMs).toISOString());
  });

  it('closes the window at the instant the run started', () => {
    const windows = dueForRefresh(
      [area({ syncedAt: new Date(NOW - 7 * HOUR) })],
      NOW,
      6 * HOUR,
      0,
      25,
    );
    expect(windows[0]?.modifiedUntil).toBe(new Date(NOW).toISOString());
  });

  it('caps the number of areas returned, oldest watermark first', () => {
    const rows = [
      area({ areaKey: 'a', syncedAt: new Date(NOW - 8 * HOUR) }),
      area({ areaKey: 'b', syncedAt: new Date(NOW - 10 * HOUR) }),
      area({ areaKey: 'c', syncedAt: new Date(NOW - 9 * HOUR) }),
    ];
    const windows = dueForRefresh(rows, NOW, 6 * HOUR, 0, 2);
    expect(windows.map((w) => w.areaKey)).toEqual(['b', 'c']);
  });

  it('returns nothing when no area is due', () => {
    expect(dueForRefresh([], NOW, 6 * HOUR, 0, 25)).toEqual([]);
  });
});
