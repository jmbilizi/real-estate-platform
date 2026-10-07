/**
 * Loading shapes for the lead desk. They share the row grid of the loaded list (`LEAD_ROW_GRID`), so the page does not jump when data arrives.
 */
export const LEAD_ROW_GRID = 'layout:grid layout:grid-cols-[2fr_2fr_1.2fr_1fr_0.6fr] layout:gap-4';

const FILL = 'block rounded-xs bg-surface-soft skeleton-fill';

function Bar({ className = '' }: { className?: string }) {
  return <span className={`${FILL} h-4 ${className}`} />;
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
    </div>
  );
}
