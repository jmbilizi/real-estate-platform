import { buildFactGroups } from '@/lib/listing-facts';
import type { ListingDetailView } from '@/lib/api/listings';

/**
 * The grouped, collapsible facts (#568). Native `details` needs no client state, so the panel
 * renders on the server. The first group starts open. A group with no data does not render, and
 * with no groups the whole section is absent.
 */
export default function ListingFacts({
  listing,
  className = '',
}: {
  listing: ListingDetailView;
  className?: string;
}) {
  const groups = buildFactGroups(listing);
  if (groups.length === 0) return null;

  return (
    <section id="facts" className={className} data-testid="listing-facts">
      <h2 className="px-6 pt-6 text-xl font-semibold tracking-tight">Facts &amp; features</h2>
      <div className="mt-2 divide-y divide-surface-border">
        {groups.map((group, i) => (
          <details key={group.id} open={i === 0} className="group px-6 py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-base font-semibold text-ink [&::-webkit-details-marker]:hidden">
              {group.title}
              <svg
                className="h-4 w-4 shrink-0 text-ink-muted transition-transform group-open:rotate-180"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </summary>
            <dl className="mt-3 space-y-3">
              {group.rows.map((row) => (
                <div key={row.label}>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                    {row.label}
                  </dt>
                  <dd className="mt-1 text-sm text-ink-body">{row.value}</dd>
                </div>
              ))}
            </dl>
          </details>
        ))}
      </div>
    </section>
  );
}
