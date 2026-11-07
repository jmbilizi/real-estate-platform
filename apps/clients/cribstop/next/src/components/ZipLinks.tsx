import Link from 'next/link';
import type { Crumb, NearbyZip } from '@/lib/zip-page';

/**
 * The breadcrumb trail and the nearby ZIP links of a ZIP page (#973). A server component, so both
 * are in the first HTML. They sit inside the "About these listings" popover, which takes no row.
 * The text comes from the feed's numbers only. It says nothing about the people or the area.
 */
export default function ZipLinks({
  crumbs,
  nearby,
  noun,
}: {
  crumbs: readonly Crumb[];
  nearby: readonly NearbyZip[];
  noun: string;
}) {
  return (
    <>
      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-x-1 text-xs text-ink-muted">
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1;
            return (
              <li key={crumb.path} className="flex items-center gap-x-1">
                {last ? (
                  <span aria-current="page" className="font-semibold text-ink-body">
                    {crumb.name}
                  </span>
                ) : (
                  <Link href={crumb.path} className="underline hover:text-ink">
                    {crumb.name}
                  </Link>
                )}
                {last ? null : <span aria-hidden="true">/</span>}
              </li>
            );
          })}
        </ol>
      </nav>
      {nearby.length > 0 ? (
        <nav aria-label="Nearby ZIP codes" className="mt-3">
          <p className="text-xs font-semibold text-ink-body">{`${noun} in nearby ZIP codes`}</p>
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted">
            {nearby.map((item) => (
              <li key={item.zip}>
                <Link href={item.path} className="underline hover:text-ink">
                  {item.zip}
                </Link>
                {` (${item.count.toLocaleString('en-US')})`}
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </>
  );
}
