'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  INQUIRY_KINDS,
  LEAD_STATUSES,
  type StaffLeadDuration,
  type StaffLeadMetrics,
} from '@cribstop/property-contracts';
import Button from '@/components/Button';
import { fetchLeadMetrics } from '@/lib/api/staff-leads';
import { formatDuration, KIND_LABEL, STATUS_LABEL } from '@/lib/staff-leads';
import { LeadMetricsSkeleton } from './LeadSkeletons';

const RANGES = [
  { value: 'all', label: 'All time', days: null },
  { value: '7', label: 'Last 7 days', days: 7 },
  { value: '30', label: 'Last 30 days', days: 30 },
  { value: '90', label: 'Last 90 days', days: 90 },
] as const;

const TILE = 'rounded-lg border border-surface-border bg-white p-4';
const LABEL = 'text-xs font-semibold text-ink-body';
const VALUE = 'mt-1 text-2xl font-bold tabular-nums text-ink';

function rangeOf(value: string): { from?: string } {
  const days = RANGES.find((r) => r.value === value)?.days ?? null;
  return days === null ? {} : { from: new Date(Date.now() - days * 86_400_000).toISOString() };
}

function DurationTile({
  label,
  duration,
  className = '',
}: {
  label: string;
  duration: StaffLeadDuration;
  className?: string;
}) {
  const { medianSeconds, p90Seconds, sampleSize } = duration;
  return (
    <div className={`${TILE} ${className}`}>
      <p className={LABEL}>{label}</p>
      <p className={VALUE}>{medianSeconds === null ? '—' : formatDuration(medianSeconds)}</p>
      <p className="mt-1 text-xs text-ink-muted">
        {medianSeconds === null || p90Seconds === null
          ? 'No data yet'
          : `Median. 90th percentile ${formatDuration(p90Seconds)}. ${sampleSize} ${
              sampleSize === 1 ? 'request' : 'requests'
            }.`}
      </p>
    </div>
  );
}

/**
 * The metrics strip above the lead list (#639). Counts and durations only. A step with no data
 * shows a dash, never a number.
 */
export default function LeadMetrics() {
  const [range, setRange] = useState('all');
  const [metrics, setMetrics] = useState<StaffLeadMetrics | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback((value: string) => {
    setFailed(false);
    setMetrics(null);
    fetchLeadMetrics(rangeOf(value))
      .then(setMetrics)
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    load(range);
  }, [load, range]);

  return (
    <section aria-label="Lead desk metrics" className="mb-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">Speed to lead</h2>
        <label className="text-xs font-semibold text-ink-body">
          <span className="sr-only">Metrics period</span>
          <select
            className="min-h-11 rounded-md border border-surface-border bg-white px-3 text-sm text-ink focus:border-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
            value={range}
            onChange={(e) => setRange(e.target.value)}
          >
            {RANGES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {failed ? (
        <div role="alert" className={`${TILE} flex flex-wrap items-center gap-3 text-sm text-ink`}>
          <span>The metrics could not be loaded.</span>
          <Button variant="secondary" size="sm" onClick={() => load(range)}>
            Try again
          </Button>
        </div>
      ) : metrics === null ? (
        <LeadMetricsSkeleton />
      ) : metrics.total === 0 ? (
        <p className={`${TILE} text-sm text-ink-muted`}>No requests in this period.</p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 layout:grid-cols-5">
            <div className={TILE}>
              <p className={LABEL}>Requests</p>
              <p className={VALUE}>{metrics.total}</p>
              <p className="mt-1 text-xs text-ink-muted">
                {INQUIRY_KINDS.map((k) => `${KIND_LABEL[k]} ${metrics.byKind[k]}`).join('. ')}
              </p>
            </div>
            <div
              className={`${TILE} ${metrics.aging.count > 0 ? 'border-amber-300 bg-amber-50' : ''}`}
            >
              <p className={LABEL}>Aging</p>
              <p className={VALUE}>{metrics.aging.count}</p>
              <p className="mt-1 text-xs text-ink-muted">
                New or Verified for over {metrics.aging.thresholdHours}h
              </p>
            </div>
            <DurationTile label="Time to verify" duration={metrics.timeToVerify} />
            <DurationTile label="Time to assign" duration={metrics.timeToAssign} />
            <DurationTile
              label="Time to accept"
              duration={metrics.timeToAccept}
              className="col-span-2 sm:col-span-1"
            />
          </div>
          <ul aria-label="Requests by status" className="flex flex-wrap gap-2">
            {LEAD_STATUSES.map((s) => (
              <li
                key={s}
                className={`rounded-full border border-surface-border bg-white px-3 py-1 text-xs tabular-nums ${
                  metrics.byStatus[s] === 0 ? 'text-ink-muted' : 'font-semibold text-ink'
                }`}
              >
                {STATUS_LABEL[s]} {metrics.byStatus[s]}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
