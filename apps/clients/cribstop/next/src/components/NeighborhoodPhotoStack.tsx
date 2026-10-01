'use client';

import { useEffect, useRef, useState } from 'react';
import type { NeighborhoodPreviewPhoto } from '@cribstop/property-contracts';

/** Photos shown at once. The API sends up to 5; the extras only replace photos that fail to load. */
export const STACK_SIZE = 3;

interface Spot {
  x: number;
  y: number;
  rot: number;
}

/**
 * Per-count layout, all in percent of the stack width so the stack scales with the tile (#492):
 * photo size, each photo's centre offset from the middle, vertical offset, and tilt in degrees.
 */
const LAYOUTS: Record<1 | 2 | 3, { size: number; spots: Spot[] }> = {
  3: {
    size: 50,
    spots: [
      { x: -20, y: 10, rot: -8 },
      { x: 0, y: 2, rot: 0 },
      { x: 20, y: 10, rot: 8 },
    ],
  },
  2: {
    size: 52,
    spots: [
      { x: -17, y: 10, rot: -6 },
      { x: 17, y: 4, rot: 6 },
    ],
  },
  1: { size: 60, spots: [{ x: 0, y: 6, rot: -3 }] },
};

/** The photo area every tile reserves, for the stack, its placeholder and the skeleton alike. */
export const PHOTO_AREA_CLASS = 'relative mb-3 aspect-[10/7] w-full';

/**
 * Overlapped, slightly rotated photos for an "Explore neighborhoods" tile (#487). Every photo is a
 * listing the tile's own link target contains (#486), so this component never takes a URL from
 * anywhere else. It is decorative: the tile heading names the place, so the photos use empty `alt`
 * and the stack adds no link of its own. With no photo it shows a neutral placeholder of the same
 * size, so tiles in a row align (#492). A plain `<img>` with `object-contain`, like
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

  if (shown.length === 0) {
    return (
      <div
        aria-hidden="true"
        data-testid="neighborhood-photo-placeholder"
        className={`${PHOTO_AREA_CLASS} rounded-md bg-surface-soft`}
      />
    );
  }

  const layout = LAYOUTS[shown.length as 1 | 2 | 3];

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      data-testid="neighborhood-photo-stack"
      className={PHOTO_AREA_CLASS}
    >
      {shown.map((photo, i) => {
        const spot = layout.spots[i];
        return (
          <span
            key={photo.url}
            className="absolute overflow-hidden rounded-md border-2 border-white bg-surface-soft shadow-card"
            style={{
              left: `${50 + spot.x - layout.size / 2}%`,
              top: `${spot.y}%`,
              width: `${layout.size}%`,
              aspectRatio: '1',
              zIndex: i + 1,
              transform: `rotate(${spot.rot}deg)`,
            }}
          >
            <img
              src={photo.url}
              alt=""
              loading="lazy"
              width={96}
              height={96}
              className="h-full w-full object-contain"
              onError={() => setFailed((prev) => new Set(prev).add(photo.url))}
            />
          </span>
        );
      })}
    </div>
  );
}
