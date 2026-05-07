"use client";

import dynamic from "next/dynamic";
import { Listing } from "@/lib/types";

const Inner = dynamic(() => import("./SingleListingMapInner"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-surface-soft">
      <span className="text-sm text-ink-muted">Loading map…</span>
    </div>
  ),
});

export default function SingleListingMap({ listing, className }: { listing: Listing; className?: string }) {
  return <Inner listing={listing} className={className} />;
}
