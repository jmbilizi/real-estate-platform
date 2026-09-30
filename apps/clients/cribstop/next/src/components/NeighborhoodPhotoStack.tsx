'use client';

import { useEffect, useRef, useState } from 'react';
import type { NeighborhoodPreviewPhoto } from '@cribstop/property-contracts';

/** Photos shown at once. The API sends up to 5; the extras only replace photos that fail to load. */
export const STACK_SIZE = 3;

/** Per-count layout in px: photo size, stack height, and each photo's offset from the centre and tilt. */
const LAYOUTS: Record<1 | 2 | 3, { size: number; height: number; spots: Spot[] }> = {
  3: {
    size: 64,
    height: 86,
    spots: [
      { x: -26, y: 10, rot: -8 },
      { x: 0, y: 0, rot: 0 },
      { x: 26, y: 10, rot: 8 },
    ],
  },
  2: {
    size: 56,
    height: 74,
    spots: [
      { x: -20, y: 8, rot: -6 },
      { x: 20, y: 0, rot: 6 },
    ],
  },
  1: { size: 56, height: 74, spots: [{ x: 0, y: 0, rot: -3 }] },
};

interface Spot {
  x: number;
  y: number;
  rot: number;
}

/** The stack height for a photo count, so the skeleton and the tile reserve the same space. */
export const STACK_HEIGHT_PX = LAYOUTS[3].height;

/**
 * Overlapped, slightly rotated photos for an "Explore neighborhoods" tile (#487). Every photo is a
 * listing the tile's own link target contains (#486), so this component never takes a URL from
 * anywhere else. It is decorative: the tile heading names the place, so the photos use empty `alt`
 * and the stack adds no link of its own. A plain `<img>` with `object-contain`, like
 * `ListingImage`: listing photos come from arbitrary hosts, and the MLS mark in a photo's corner
 * must not be cropped.
 */
export default function NeighborhoodPhotoStack({ photos }: { photos: NeighborhoodPreviewPhoto[] }) {
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);

  const shown = photos.filter((p) => !failed.has(p.url)).slice(0, STACK_SIZE);

  // A photo can fail before hydration attaches `onError`. Re-check each `<img>` once it mounts.
  useEffect(() => {
    const broken = Array.from(rootRef.current?.querySelectorAll('img') ?? []).filter(
      (img) => img.complete && img.naturalWidth === 0,
    );
    if (broken.length === 0) return;
    setFailed((prev) => new Set([...prev, ...broken.map((img) => img.getAttribute('src') ?? '')]));
  }, [shown.length]);

  if (shown.length === 0) return null;

  const layout = LAYOUTS[shown.length as 1 | 2 | 3];

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      data-testid="neighborhood-photo-stack"
      className="relative mb-3 w-full"
      style={{ height: layout.height }}
    >
      {shown.map((photo, i) => {
        const spot = layout.spots[i];
        return (
          <span
            key={photo.url}
            className="absolute overflow-hidden rounded-md border-2 border-white bg-surface-soft shadow-card"
            style={{
              left: '50%',
              top: 0,
              width: layout.size,
              height: layout.size,
              zIndex: i + 1,
              transform: `translateX(-50%) translate(${spot.x}px, ${spot.y}px) rotate(${spot.rot}deg)`,
            }}
          >
            <img
              src={photo.url}
              alt=""
              loading="lazy"
              width={layout.size}
              height={layout.size}
              className="h-full w-full object-contain"
              onError={() => setFailed((prev) => new Set(prev).add(photo.url))}
            />
          </span>
        );
      })}
    </div>
  );
}
