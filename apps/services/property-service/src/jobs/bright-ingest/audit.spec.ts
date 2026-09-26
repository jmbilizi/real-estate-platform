import { auditCity, type AuditStatus, formatAuditTable, runAudit } from './audit';

const ACTIVE: AuditStatus = { code: 'Active', resoStandardStatus: 'Active' };
const PENDING: AuditStatus = { code: 'Pending', resoStandardStatus: 'Pending' };
const STATUSES: readonly AuditStatus[] = [ACTIVE, PENDING];

/** A mocked Bright response and a mocked local query, keyed by city + status code. */
function fakeDeps(
  bright: Record<string, Record<string, number>>,
  local: Record<string, Record<string, number>>,
): {
  deps: {
    fetchBrightCount: (city: string, status: AuditStatus) => Promise<number>;
    fetchLocalCount: (city: string, status: AuditStatus) => Promise<number>;
  };
  brightCalls: Array<[string, string]>;
  localCalls: Array<[string, string]>;
} {
  const brightCalls: Array<[string, string]> = [];
  const localCalls: Array<[string, string]> = [];
  return {
    brightCalls,
    localCalls,
    deps: {
      fetchBrightCount: async (city, status) => {
        brightCalls.push([city, status.code]);
        return bright[city]?.[status.code] ?? 0;
      },
      fetchLocalCount: async (city, status) => {
        localCalls.push([city, status.code]);
        return local[city]?.[status.code] ?? 0;
      },
    },
  };
}

describe('auditCity', () => {
  it('sums the mocked Bright response and the mocked local query across every status', async () => {
    const { deps } = fakeDeps(
      { Frederick: { Active: 100, Pending: 20 } },
      { Frederick: { Active: 60, Pending: 20 } },
    );

    expect(await auditCity('Frederick', STATUSES, deps)).toEqual({
      city: 'Frederick',
      brightCount: 120,
      localCount: 80,
      delta: 40,
    });
  });

  it('sends one request per status, never one OR-combined request', async () => {
    const { deps, brightCalls, localCalls } = fakeDeps(
      { Baltimore: { Active: 5, Pending: 3 } },
      { Baltimore: { Active: 5, Pending: 3 } },
    );

    await auditCity('Baltimore', STATUSES, deps);

    expect(brightCalls).toEqual([
      ['Baltimore', 'Active'],
      ['Baltimore', 'Pending'],
    ]);
    expect(localCalls).toEqual([
      ['Baltimore', 'Active'],
      ['Baltimore', 'Pending'],
    ]);
  });

  it('reports a negative delta when the local count exceeds Bright — a staleness signal', async () => {
    const { deps } = fakeDeps({ Rockville: { Active: 10 } }, { Rockville: { Active: 15 } });

    const result = await auditCity('Rockville', [ACTIVE], deps);

    expect(result.delta).toBe(-5);
  });
});

describe('runAudit', () => {
  it('audits every city in order', async () => {
    const { deps } = fakeDeps(
      { Frederick: { Active: 10 }, Baltimore: { Active: 50 } },
      { Frederick: { Active: 10 }, Baltimore: { Active: 40 } },
    );

    const results = await runAudit(['Frederick', 'Baltimore'], [ACTIVE], deps);

    expect(results.map((r) => r.city)).toEqual(['Frederick', 'Baltimore']);
    expect(results[1]).toEqual({
      city: 'Baltimore',
      brightCount: 50,
      localCount: 40,
      delta: 10,
    });
  });
});

describe('formatAuditTable', () => {
  it('renders a header, a separator, and one row per city', () => {
    const table = formatAuditTable([
      { city: 'Frederick', brightCount: 120, localCount: 80, delta: 40 },
      { city: 'Washington', brightCount: 5000, localCount: 4990, delta: 10 },
    ]);
    const lines = table.split('\n');

    expect(lines[0]).toMatch(/City\s+Bright count\s+Local count\s+Delta/);
    expect(lines[1]).toMatch(/^-+\s+-+\s+-+\s+-+$/);
    expect(lines[2]).toMatch(/Frederick\s+120\s+80\s+40/);
    expect(lines[3]).toMatch(/Washington\s+5000\s+4990\s+10/);
  });
});
