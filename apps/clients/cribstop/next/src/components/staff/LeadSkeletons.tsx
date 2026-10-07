/**
 * Loading shapes for the lead desk. They share the row grid of the loaded list (`LEAD_ROW_GRID`), so the page does not jump when data arrives.
 */
export const LEAD_ROW_GRID = 'layout:grid layout:grid-cols-[2fr_2fr_1.2fr_1fr_0.6fr] layout:gap-4';

const FILL = 'block rounded-xs bg-surface-soft skeleton-fill';

function Bar({ className = '' }: { className?: string }) {
  return <span className={`${FILL} h-4 ${className}`} />;
}

/** The tiles and chip row of `LeadMetrics`. Same grid as the loaded strip. */
export function LeadMetricsSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-3" data-testid="lead-metrics-skeleton">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 layout:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div
            key={i}
            className={`rounded-lg border border-surface-border bg-white p-4 ${i === 4 ? 'col-span-2 sm:col-span-1' : ''}`}
          >
            <Bar className="w-1/2" />
            <span className={`${FILL} mt-1 h-8 w-16`} />
            <Bar className="mt-1 w-3/4" />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className={`${FILL} h-6 w-20 rounded-full`} />
        ))}
      </div>
    </div>
  );
}

/** The whole strip, header included, for the route's loading state. */
export function LeadMetricsSectionSkeleton() {
  return (
    <div className="mb-6">
      <div className="mb-3 flex items-center justify-between gap-2">
        <Bar className="w-28" />
        <span className={`${FILL} h-11 w-32 rounded-md`} />
      </div>
      <LeadMetricsSkeleton />
    </div>
  );
}

export function LeadsListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <ul
      aria-hidden="true"
      className="space-y-3 layout:space-y-0 layout:divide-y layout:divide-surface-border"
      data-testid="leads-skeleton"
    >
      {Array.from({ length: rows }, (_, i) => (
        <li
          key={i}
          className={`rounded-lg border border-surface-border bg-white p-4 layout:rounded-none layout:border-0 layout:px-4 ${LEAD_ROW_GRID} layout:items-center`}
        >
          <div className="space-y-2">
            <Bar className="w-2/3" />
            <span className={`${FILL} h-5 w-20 rounded-full`} />
          </div>
          <div className="mt-3 space-y-2 layout:mt-0">
            <Bar className="w-3/4" />
            <Bar className="w-1/3" />
          </div>
          <Bar className="mt-3 w-24 layout:mt-0" />
          <Bar className="mt-3 w-16 layout:mt-0" />
          <Bar className="mt-3 w-8 layout:mt-0" />
        </li>
      ))}
    </ul>
  );
}

function SectionSkeleton({ lines }: { lines: number }) {
  return (
    <div className="rounded-lg border border-surface-border bg-white p-4 sm:p-5">
      <Bar className="mb-4 w-32" />
      <div className="space-y-3">
        {Array.from({ length: lines }, (_, i) => (
          <Bar key={i} className={i % 2 ? 'w-2/3' : 'w-full'} />
        ))}
      </div>
    </div>
  );
}

export function LeadDetailSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-4" data-testid="lead-detail-skeleton">
      <div className="space-y-3">
        <span className={`${FILL} h-8 w-1/2`} />
        <span className={`${FILL} h-5 w-24 rounded-full`} />
      </div>
      <SectionSkeleton lines={4} />
      <SectionSkeleton lines={3} />
      <SectionSkeleton lines={3} />
      <SectionSkeleton lines={2} />
    </div>
  );
}

/** The radio rows of the assign picker. Same 44px row as the loaded list. */
export function AgentPickerSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <ul aria-hidden="true" className="space-y-2" data-testid="agent-picker-skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <li
          key={i}
          className="flex min-h-11 items-center gap-3 rounded-md border border-surface-border px-3 py-2"
        >
          <span className={`${FILL} size-5 rounded-full`} />
          <span className="flex-1 space-y-2">
            <Bar className="w-1/2" />
            <Bar className="h-3 w-1/3" />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Same card shape and breakpoint as `AgentsList`: stacked cards on a phone, a row on a wide screen. */
export function AgentsListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <ul aria-hidden="true" className="space-y-3" data-testid="agents-skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <li
          key={i}
          className="rounded-lg border border-surface-border bg-white p-4 layout:flex layout:items-center layout:gap-4"
        >
          <div className="min-w-0 flex-1 space-y-2">
            <Bar className="w-1/2" />
            <Bar className="h-3 w-1/3" />
          </div>
          <span className={`${FILL} mt-3 block h-5 w-16 rounded-full layout:mt-0`} />
          <span className={`${FILL} mt-3 block h-11 w-full rounded-full layout:mt-0 layout:w-40`} />
        </li>
      ))}
    </ul>
  );
}
