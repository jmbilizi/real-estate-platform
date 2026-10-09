'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMap } from 'react-leaflet';
import type { LngLat } from '@/lib/draw-area';
import {
  createDrawGesture,
  lockMapInteraction,
  type DrawPointer,
  type LockableMap,
} from '@/lib/draw-gesture';

/** What the parent made of a finished line. Anything but `ok` keeps draw mode on. */
export type DrawOutcome = 'ok' | 'too-small' | 'crossed';

const HINT = 'Press and drag to draw a loop around the homes you want. Lift to finish.';
const NOTICES: Record<Exclude<DrawOutcome, 'ok'>, string> = {
  'too-small': 'That shape is too small. Draw a loop around the homes you want.',
  crossed: 'That line crosses itself. Draw the loop again without crossing it.',
};

/**
 * The freehand draw surface (#747). It sits over the map while draw mode is on. Pan, drag-zoom and
 * double-click zoom are off for as long as it is mounted, and each returns to its earlier state when
 * it unmounts. `touch-action: none` keeps a finger on the surface from scrolling the page.
 */
export default function MapDrawLayer({
  onFinish,
  onCancel,
}: {
  onFinish: (path: readonly LngLat[]) => DrawOutcome;
  onCancel: () => void;
}) {
  const map = useMap();
  const surface = useRef<HTMLDivElement>(null);
  const px = useRef<[number, number][]>([]);
  const [points, setPoints] = useState<[number, number][]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    const restore = lockMapInteraction(map as unknown as LockableMap);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancelRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      restore();
    };
  }, [map]);

  const gesture = useMemo(
    () =>
      createDrawGesture({
        toLngLat: (clientX, clientY) => {
          const rect = surface.current?.getBoundingClientRect();
          const point: [number, number] = [clientX - (rect?.left ?? 0), clientY - (rect?.top ?? 0)];
          px.current.push(point);
          const latLng = map.containerPointToLatLng(point);
          return [latLng.lng, latLng.lat];
        },
        onChange: () => setPoints([...px.current]),
        onFinish: (path) => {
          px.current = [];
          setPoints([]);
          const outcome = onFinishRef.current(path);
          setNotice(outcome === 'ok' ? null : NOTICES[outcome]);
        },
      }),
    [map],
  );

  const toPointer = (event: React.PointerEvent): DrawPointer => ({
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
    isPrimary: event.isPrimary,
  });

  return (
    <>
      <div
        ref={surface}
        data-testid="draw-surface"
        className="absolute inset-0 z-[500] cursor-crosshair"
        style={{ touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' }}
        onPointerDown={(event) => {
          event.stopPropagation();
          px.current = [];
          setNotice(null);
          if (gesture.down(toPointer(event))) {
            // A capture keeps the drag on this surface when the finger leaves the map.
            surface.current?.setPointerCapture?.(event.pointerId);
          }
        }}
        onPointerMove={(event) => gesture.move(toPointer(event))}
        onPointerUp={(event) => gesture.up(toPointer(event))}
        onPointerCancel={() => {
          px.current = [];
          gesture.cancel();
        }}
      >
        {points.length > 1 && (
          <svg className="pointer-events-none h-full w-full" aria-hidden="true">
            <polygon
              data-testid="draw-preview"
              points={points.map(([x, y]) => `${x},${y}`).join(' ')}
              fill="rgba(255,56,92,0.12)"
              stroke="#FF385C"
              strokeWidth={3}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
        )}
      </div>
      <div className="pointer-events-none absolute inset-x-3 bottom-4 z-[1000] flex flex-col items-center gap-2">
        <p
          role="status"
          data-testid="draw-hint"
          className="max-w-xs rounded-2xl bg-ink/85 px-3 py-1.5 text-center text-[11px] font-semibold text-white shadow-card backdrop-blur"
        >
          {notice ?? HINT}
        </p>
        <button
          type="button"
          data-testid="draw-cancel"
          onClick={onCancel}
          className="pointer-events-auto inline-flex h-11 min-w-[44px] cursor-pointer items-center justify-center rounded-full bg-surface px-5 text-sm font-semibold text-ink shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1"
        >
          Cancel
        </button>
      </div>
    </>
  );
}
