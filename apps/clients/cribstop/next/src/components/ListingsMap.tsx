'use client';

import dynamic from 'next/dynamic';
import { Listing } from '@/lib/types';

interface Props {
  listings: Listing[];
  activeId?: string | null;
  savedIds?: Set<string>;
  onMarkerHover?: (id: string | null) => void;
  className?: string;
  searchCenter?: [number, number] | null;
  searchPolygon?: object | null;
}

const Inner = dynamic(() => import('./ListingsMapInner'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-surface-soft">
      <div className="flex items-center gap-2 text-sm text-ink-muted">
        <span className="h-2 w-2 animate-pulse rounded-full bg-brand" />
        Loading map…
      </div>
    </div>
  ),
});

export default function ListingsMap(props: Props) {
  return <Inner {...props} />;
}
