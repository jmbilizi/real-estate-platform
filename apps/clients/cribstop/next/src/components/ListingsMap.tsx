'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { ListingCardRow } from '@/lib/types';
import { MAP_PANEL_CLASS } from './map-panel';

interface Props {
  listings: ListingCardRow[];
  activeId?: string | null;
  savedIds?: Set<string>;
  onMarkerHover?: (id: string | null) => void;
  className?: string;
  searchCenter?: [number, number] | null;
  searchPolygon?: object | null;
  /**
   * Whether the map may start loading, as opposed to being deliberately held on its placeholder.
   *
   * Separate from the mount gate below because they answer different questions: `mounted` is "does
   * `window` exist yet", this is "should this map be competing for the network right now". The
   * backdrop behind a directly-loaded listing needs the second one — the panel is the thing the
   * user asked for, and the tiles must not queue up in front of it — while still drawing the frame
   * so the layout is not a hole.
   */
  active?: boolean;
}

/** The one placeholder, used both before mount and while the map chunk is in flight. */
function MapLoadingLabel() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex items-center gap-2 text-sm text-ink-muted">
        <span className="h-2 w-2 animate-pulse rounded-full bg-brand" />
        Loading map…
      </div>
    </div>
  );
}

/**
 * Leaflet needs `window`, so the map itself cannot be server-rendered — but note how that is
 * arranged, because the obvious way is a trap.
 *
 * This used `dynamic(..., { ssr: false })`. In the App Router that does not merely skip the
 * component: it renders `<BailoutToCSR>`, which **throws** during server rendering. The throw is
 * not contained by the boundary `next/dynamic` puts around it, nor by one added by hand around this
 * component (both tried) — it unwinds to the route's own Suspense boundary. On the search route that
 * is `app/(with-search)/search/page.tsx`, so a single `ssr: false` map took the *entire* search
 * experience out of the first HTML: the split layout, the results bar, the card skeletons, all of
 * it. The document's `<main>` held the search bar and the word "Loading search…", and everything
 * else waited for the client bundle before it could even begin. That is the empty body, and the
 * delay was the listing fetch queueing up behind it.
 *
 * So SSR is skipped for the leaflet subtree only, by gating it on mount rather than by bailing the
 * server render out. `dynamic` still code-splits it — the chunk is not in the initial bundle — and
 * because nothing renders `<Inner>` on the server, `SingleListingMapInner` is never imported there
 * and never touches `window`.
 */
const Inner = dynamic(() => import('./ListingsMapInner'), {
  loading: () => <MapLoadingLabel />,
});

export default function ListingsMap({ className, active = true, ...rest }: Props) {
  /*
   * False on the server and on the first client render, so the two agree; true from the effect
   * onwards, which is the first moment `window` exists.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  /*
   * The wrapper carries the frame and the caller's sizing, and is plain enough to render on the
   * server. That is what removes both of the old arrangement's problems at once: a placeholder
   * shaped differently from the map it stands in for, and a slot with nothing painted in it until
   * the client caught up.
   */
  return (
    <div className={`${MAP_PANEL_CLASS} ${className ?? ''}`}>
      {mounted && active ? <Inner {...rest} /> : <MapLoadingLabel />}
    </div>
  );
}
