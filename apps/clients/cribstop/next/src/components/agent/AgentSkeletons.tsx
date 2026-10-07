/** Loading shapes of the agent area. They follow the card layout of the loaded screens. */
const FILL = 'block rounded-xs bg-surface-soft skeleton-fill';

function Bar({ className = '' }: { className?: string }) {
  return <span className={`${FILL} h-4 ${className}`} />;
}

export function AgentLeadsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <ul aria-hidden="true" className="space-y-3" data-testid="agent-leads-skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="space-y-3 rounded-lg border border-surface-border bg-white p-4">
          <div className="flex items-center justify-between">
            <span className={`${FILL} h-5 w-20 rounded-full`} />
            <Bar className="w-10" />
          </div>
          <Bar className="w-3/4" />
          <Bar className="w-1/2" />
          <div className="flex gap-2">
            <span className={`${FILL} h-11 flex-1 rounded-md`} />
            <span className={`${FILL} h-11 flex-1 rounded-md`} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Section({ lines }: { lines: number }) {
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

export function AgentLeadDetailSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-4" data-testid="agent-detail-skeleton">
      <div className="space-y-3">
        <span className={`${FILL} h-8 w-2/3`} />
        <span className={`${FILL} h-5 w-24 rounded-full`} />
      </div>
      <Section lines={3} />
      <Section lines={3} />
      <Section lines={3} />
    </div>
  );
}
