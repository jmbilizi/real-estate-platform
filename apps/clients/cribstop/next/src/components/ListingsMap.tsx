'use client';

import dynamic from 'next/dynamic';
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
}

/**
 * Leaflet needs `window`, so the map itself cannot be server-rendered. The **panel** can be, and
 * now is: only the label below is deferred, and it inherits the frame from the wrapper instead of
 * inventing a flat grey one of its own.
 */
const Inner = dynamic(() => import('./ListingsMapInner'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex items-center gap-2 text-sm text-ink-muted">
        <span className="h-2 w-2 animate-pulse rounded-full bg-brand" />
        Loading map…
      </div>
    </div>
  ),
});

export default function ListingsMap({ className, ...rest }: Props) {
  /*
   * The wrapper carries the frame and the caller's sizing, and is plain enough to render on the
   * server. That is what removes both of the old arrangement's problems at once: a placeholder
   * shaped differently from the map it stands in for, and a slot with nothing painted in it until
   * the client caught up.
   */
  return (
    <div className={`${MAP_PANEL_CLASS} ${className ?? ''}`}>
      <Inner {...rest} />
    </div>
  );
}
