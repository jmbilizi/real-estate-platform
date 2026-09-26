/**
 * The count-comparison logic behind the Bright `$count` audit (#328).
 *
 * The audit's PURPOSE is one measurement: for each city, does our local read model's count match
 * Bright's own count across every publicly searchable status? Everything that can go wrong with an
 * OAuth token, an HTTPS host, or a Postgres connection belongs to `bright-audit.main.ts`, which wires
 * the real Bright client and the real pool. This module takes counts as already-fetched numbers, so
 * a test never needs a mocked HTTP server or a real database — see `audit.spec.ts`.
 *
 * A status is looked up once per city, never OR'd into a single Bright request: Bright rejects `OR`
 * in `$filter` (see `odata-query.ts`), so the caller wiring `AuditDeps.fetchBrightCount` sends one
 * `$count` request per status and this module sums them.
 */

/** One Bright status this run measures. Both fields are read from `listing_statuses` (#328). */
export interface AuditStatus {
  /** `listing_statuses.code`, matched against the local read model's `source_status`. */
  readonly code: string;
  /** `listing_statuses.reso_standard_status`, Bright's own `StandardStatus` wire value. */
  readonly resoStandardStatus: string;
}

export interface AuditCityResult {
  readonly city: string;
  readonly brightCount: number;
  readonly localCount: number;
  /** `brightCount - localCount`. Positive means Bright holds more than we do. */
  readonly delta: number;
}

/** The two counting operations, injected so this module never opens a socket or a connection. */
export interface AuditDeps {
  readonly fetchBrightCount: (city: string, status: AuditStatus) => Promise<number>;
  readonly fetchLocalCount: (city: string, status: AuditStatus) => Promise<number>;
}

/** Sums both sources across every status for one city. */
export async function auditCity(
  city: string,
  statuses: readonly AuditStatus[],
  deps: AuditDeps,
): Promise<AuditCityResult> {
  let brightCount = 0;
  let localCount = 0;
  for (const status of statuses) {
    brightCount += await deps.fetchBrightCount(city, status);
    localCount += await deps.fetchLocalCount(city, status);
  }
  return { city, brightCount, localCount, delta: brightCount - localCount };
}

/**
 * Runs `auditCity` for every city, in order, one at a time.
 *
 * Sequential rather than `Promise.all`: the real wiring shares one rate-limited Bright token
 * provider and one pooled connection, and a parallel fan-out across ten cities times several
 * statuses each would be the same unbounded-concurrency mistake `RateLimiter` exists to prevent
 * elsewhere in this job.
 */
export async function runAudit(
  cities: readonly string[],
  statuses: readonly AuditStatus[],
  deps: AuditDeps,
): Promise<AuditCityResult[]> {
  const results: AuditCityResult[] = [];
  for (const city of cities) {
    results.push(await auditCity(city, statuses, deps));
  }
  return results;
}

/** Column width helper: pads on the right, never truncates — a table meant for a terminal or a PR. */
function padRight(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

/**
 * Renders the audit as a plain-text table: city, Bright count, local count, delta.
 *
 * This is the ticket's main deliverable for the stakeholder, so it stays a single self-contained
 * string a run can print or paste into a PR/ticket comment without any other formatting step.
 */
export function formatAuditTable(results: readonly AuditCityResult[]): string {
  const headers = ['City', 'Bright count', 'Local count', 'Delta'] as const;
  const rows = results.map((r) => [
    r.city,
    String(r.brightCount),
    String(r.localCount),
    String(r.delta),
  ]);
  const widths = headers.map((header, i) =>
    Math.max(header.length, ...rows.map((row) => row[i]?.length ?? 0)),
  );
  const line = (cells: readonly string[]): string =>
    cells.map((cell, i) => padRight(cell, widths[i] ?? 0)).join('  ');
  return [line(headers), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n');
}
