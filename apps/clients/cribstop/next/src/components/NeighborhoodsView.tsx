import Link from 'next/link';
import { NeighborhoodTile, NeighborhoodTileSkeleton } from '@/components/NeighborhoodRow';
import type { NeighborhoodsSection } from '@/lib/api/neighborhoods-server';
import { NEIGHBORHOODS_PAGE_LIMIT } from '@/lib/neighborhoods';

/** One grid for real tiles and skeletons: 2 columns at 360px, up to 6 on wide screens. */
export const NEIGHBORHOODS_GRID_CLASS =
  'grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6';

const PAGE_CLASS = 'mx-auto max-w-[1760px] px-6 py-8 sm:px-10 lg:px-20';

export function NeighborhoodsHeading() {
  return (
    <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
      Neighborhoods
    </h1>
  );
}

/** Same grid and tile skeletons the page streams in behind. */
export function NeighborhoodsSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className={PAGE_CLASS} aria-busy="true">
      <NeighborhoodsHeading />
      <div className={`mt-6 ${NEIGHBORHOODS_GRID_CLASS}`}>
        {Array.from({ length: count }, (_, i) => (
          <NeighborhoodTileSkeleton key={i} grid />
        ))}
      </div>
    </div>
  );
}

export default function NeighborhoodsView({ sections }: { sections: NeighborhoodsSection[] }) {
  return (
    <div className={PAGE_CLASS}>
      <NeighborhoodsHeading />
      {sections.length === 0 ? (
        <p className="mt-6 text-ink-muted">
          We have no neighborhoods to show right now.{' '}
          <Link href="/homes-for-sale" className="font-semibold text-ink underline">
            Browse homes for sale
          </Link>
        </p>
      ) : (
        sections.map((section) => (
          <section key={section.key} className="mt-8">
            <h2 className="font-display text-lg font-semibold sm:text-xl">{section.heading}</h2>
            {section.truncated && (
              <p className="mt-1 text-sm text-ink-muted">
                This list shows the {NEIGHBORHOODS_PAGE_LIMIT} neighborhoods with the most listings.
              </p>
            )}
            <div className={`mt-4 ${NEIGHBORHOODS_GRID_CLASS}`}>
              {section.neighborhoods.map((n) => (
                <NeighborhoodTile key={`${n.name}|${n.city}|${n.state}`} n={n} grid />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
