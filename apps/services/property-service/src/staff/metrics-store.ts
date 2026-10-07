import {
  INQUIRY_KINDS,
  LEAD_STATUSES,
  type StaffLeadDuration,
  type StaffLeadMetrics,
  type StaffLeadMetricsRequest,
} from '@cribstop/property-contracts';
import type { Queryable } from '../inquiries/write';

/**
 * Read-only aggregates for the lead desk metrics (#639). Every value comes from
 * `listing_inquiries` and `lead_status_events`. The date range selects leads by creation time and
 * applies to every value. Nothing here reads a contact field.
 */

/** A step is the first `to` event of a lead, minus the latest `from` event before it. */
const STEPS = [
  ['verify', 'new', 'verified'],
  ['assign', 'verified', 'assigned'],
  ['accept', 'assigned', 'accepted'],
] as const;

const RANGE_SQL =
  '($1::timestamptz IS NULL OR created_at >= $1) AND ($2::timestamptz IS NULL OR created_at < $2)';

const COUNTS_SQL = `
  SELECT status, kind, count(*)::int AS n
  FROM listing_inquiries
  WHERE ${RANGE_SQL}
  GROUP BY status, kind`;

/** Time in the current status is the time since the latest status event. */
const AGING_SQL = `
  SELECT count(*)::int AS n
  FROM listing_inquiries l
  WHERE l.status IN ('new', 'verified')
    AND ($1::timestamptz IS NULL OR l.created_at >= $1)
    AND ($2::timestamptz IS NULL OR l.created_at < $2)
    AND (SELECT max(e.created_at) FROM lead_status_events e WHERE e.lead_id = l.id)
        < now() - make_interval(hours => $3::int)`;

const DURATIONS_SQL = `
  WITH cohort AS (SELECT id FROM listing_inquiries WHERE ${RANGE_SQL}),
  steps(step, from_status, to_status) AS (
    VALUES ${STEPS.map(([s, a, b]) => `('${s}', '${a}', '${b}')`).join(', ')}
  ),
  spans AS (
    SELECT st.step, extract(epoch FROM f.t - s.t) AS secs
    FROM steps st
    CROSS JOIN LATERAL (
      SELECT e.lead_id, min(e.created_at) AS t
      FROM lead_status_events e JOIN cohort c ON c.id = e.lead_id
      WHERE e.to_status = st.to_status
      GROUP BY e.lead_id
    ) f
    CROSS JOIN LATERAL (
      SELECT max(a.created_at) AS t
      FROM lead_status_events a
      WHERE a.lead_id = f.lead_id AND a.to_status = st.from_status AND a.created_at <= f.t
    ) s
    WHERE s.t IS NOT NULL
  )
  SELECT step,
         count(*)::int AS n,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY secs) AS median,
         percentile_cont(0.9) WITHIN GROUP (ORDER BY secs) AS p90
  FROM spans
  GROUP BY step`;

const EMPTY_DURATION: StaffLeadDuration = { sampleSize: 0, medianSeconds: null, p90Seconds: null };

export async function readLeadMetrics(
  db: Queryable,
  request: StaffLeadMetricsRequest,
  agingHours: number,
): Promise<StaffLeadMetrics> {
  const range = [request.from ?? null, request.to ?? null];

  const counts = await db.query<{ status: string; kind: string; n: number }>(COUNTS_SQL, range);
  const aging = await db.query<{ n: number }>(AGING_SQL, [...range, agingHours]);
  const durations = await db.query<{
    step: string;
    n: number;
    median: number | string;
    p90: number | string;
  }>(DURATIONS_SQL, range);

  const byStatus = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0])) as Record<string, number>;
  const byKind = Object.fromEntries(INQUIRY_KINDS.map((k) => [k, 0])) as Record<string, number>;
  let total = 0;
  for (const row of counts.rows) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + row.n;
    byKind[row.kind] = (byKind[row.kind] ?? 0) + row.n;
    total += row.n;
  }

  const durationOf = (step: string): StaffLeadDuration => {
    const row = durations.rows.find((r) => r.step === step);
    if (!row) return EMPTY_DURATION;
    return {
      sampleSize: row.n,
      medianSeconds: Math.round(Number(row.median)),
      p90Seconds: Math.round(Number(row.p90)),
    };
  };

  return {
    range: { from: request.from ?? null, to: request.to ?? null },
    total,
    byStatus: byStatus as StaffLeadMetrics['byStatus'],
    byKind: byKind as StaffLeadMetrics['byKind'],
    aging: { thresholdHours: agingHours, count: aging.rows[0]?.n ?? 0 },
    timeToVerify: durationOf('verify'),
    timeToAssign: durationOf('assign'),
    timeToAccept: durationOf('accept'),
  };
}
