import type { AreaSyncRow, AreaSyncRows } from './area-coverage-store';
import { isAreaComplete, needsAreaLoad, pickNextStatus } from './area-coverage';

const HOUR = 60 * 60 * 1000;

function row(overrides: Partial<AreaSyncRow> = {}): AreaSyncRow {
  return {
    sourceStatus: 'Active',
    status: 'complete',
    sourceCount: 10,
    loadedCount: 10,
    resumeKey: null,
    syncedAt: new Date('2026-09-01T00:00:00Z'),
    attemptedAt: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  };
}

function rows(entries: Record<string, AreaSyncRow>): AreaSyncRows {
  return new Map(Object.entries(entries));
}

describe('isAreaComplete', () => {
  it('is true only when every searchable status has a complete row', () => {
    const complete = rows({
      Active: row({ sourceStatus: 'Active' }),
      Closed: row({ sourceStatus: 'Closed' }),
    });
    expect(isAreaComplete(complete, ['Active', 'Closed'])).toBe(true);
  });

  it('is false when a searchable status has no row at all', () => {
    const partial = rows({ Active: row({ sourceStatus: 'Active' }) });
    expect(isAreaComplete(partial, ['Active', 'Closed'])).toBe(false);
  });

  it('is false when a status row exists but is only partial', () => {
    const partial = rows({
      Active: row({ sourceStatus: 'Active', status: 'partial' }),
      Closed: row({ sourceStatus: 'Closed' }),
    });
    expect(isAreaComplete(partial, ['Active', 'Closed'])).toBe(false);
  });
});

describe('needsAreaLoad', () => {
  const now = new Date('2026-09-26T00:00:00Z').getTime();

  it('triggers when the area has never been synced (no rows at all)', () => {
    expect(needsAreaLoad(rows({}), ['Active'], 24 * HOUR, now)).toBe(true);
  });

  it('triggers for a partial area, regardless of how recently it was attempted', () => {
    const partial = rows({
      Active: row({ status: 'partial', attemptedAt: new Date(now - 60_000) }),
    });
    expect(needsAreaLoad(partial, ['Active'], 24 * HOUR, now)).toBe(true);
  });

  it('triggers for a failed status', () => {
    const failed = rows({ Active: row({ status: 'failed' }) });
    expect(needsAreaLoad(failed, ['Active'], 24 * HOUR, now)).toBe(true);
  });

  it('does not trigger for a complete area synced within the freshness window', () => {
    const fresh = rows({ Active: row({ syncedAt: new Date(now - HOUR) }) });
    expect(needsAreaLoad(fresh, ['Active'], 24 * HOUR, now)).toBe(false);
  });

  it('triggers for a complete area whose sync is older than the freshness window', () => {
    const stale = rows({ Active: row({ syncedAt: new Date(now - 48 * HOUR) }) });
    expect(needsAreaLoad(stale, ['Active'], 24 * HOUR, now)).toBe(true);
  });

  it('never triggers when no status is currently searchable', () => {
    expect(needsAreaLoad(rows({}), [], 24 * HOUR, now)).toBe(false);
  });
});

describe('pickNextStatus', () => {
  const now = new Date('2026-09-26T00:00:00Z').getTime();
  const cooldownMs = HOUR;
  const failedCooldownMs = 5 * 60 * 1000;

  it('picks the first status with no row at all', () => {
    const existing = rows({ Active: row({ sourceStatus: 'Active' }) });
    expect(
      pickNextStatus(['Active', 'ComingSoon'], existing, now, cooldownMs, failedCooldownMs),
    ).toBe('ComingSoon');
  });

  it('skips a complete status, and a not-yet-cooled-down one, to make forward progress elsewhere', () => {
    // Active is done. ComingSoon is partial and still on cooldown, so a busy status cannot block
    // Closed (or any other not-yet-attempted status) from making progress this call (#329).
    const existing = rows({
      Active: row({ sourceStatus: 'Active' }),
      ComingSoon: row({
        sourceStatus: 'ComingSoon',
        status: 'partial',
        attemptedAt: new Date(now),
      }),
    });
    expect(
      pickNextStatus(
        ['Active', 'ComingSoon', 'Closed'],
        existing,
        now,
        cooldownMs,
        failedCooldownMs,
      ),
    ).toBe('Closed');
  });

  it('resumes a partial status once its cooldown has elapsed', () => {
    const existing = rows({
      Active: row({
        sourceStatus: 'Active',
        status: 'partial',
        attemptedAt: new Date(now - cooldownMs - 1),
      }),
    });
    expect(pickNextStatus(['Active'], existing, now, cooldownMs, failedCooldownMs)).toBe('Active');
  });

  it('retries a failed status well before the full hour, using failedCooldownMs', () => {
    const existing = rows({
      Active: row({
        sourceStatus: 'Active',
        status: 'failed',
        attemptedAt: new Date(now - failedCooldownMs - 1),
      }),
    });
    expect(pickNextStatus(['Active'], existing, now, cooldownMs, failedCooldownMs)).toBe('Active');
  });

  it('does not retry a failed status before failedCooldownMs elapses', () => {
    const existing = rows({
      Active: row({ sourceStatus: 'Active', status: 'failed', attemptedAt: new Date(now) }),
    });
    expect(pickNextStatus(['Active'], existing, now, cooldownMs, failedCooldownMs)).toBeNull();
  });

  it('returns null once every status is complete', () => {
    const existing = rows({
      Active: row({ sourceStatus: 'Active' }),
      Closed: row({ sourceStatus: 'Closed' }),
    });
    expect(
      pickNextStatus(['Active', 'Closed'], existing, now, cooldownMs, failedCooldownMs),
    ).toBeNull();
  });
});
