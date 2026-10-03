/**
 * Overlap layout for the listing map (#546). Pure, so it runs without Leaflet.
 *
 * Every home is on the map at its exact spot. A home draws as a price pill, or as a dot when a pill
 * would overlap one already placed. The layout never removes a home. It only picks the form.
 */

/** Pill body height in px. */
export const PILL_BODY_H = 28;
/** Height of the pointer tail under the pill body. The tail tip sits on the coordinate. */
export const PILL_TAIL_H = 7;
/** Space above the pill body. It makes the whole icon box 44px tall, the minimum tap target. */
export const PILL_HIT_TOP = 9;
export const PILL_BOX_H = PILL_HIT_TOP + PILL_BODY_H + PILL_TAIL_H;
export const PILL_MIN_W = 44;
const PILL_PAD_X = 10;
const CHAR_W = 7.4;
const GAP = 2;

/** Width of the pill icon box for a label. Never below the 44px tap target. */
export function pillWidth(label: string): number {
  return Math.max(PILL_MIN_W, Math.round(label.length * CHAR_W) + PILL_PAD_X * 2);
}

export interface PinPoint {
  id: string;
  /** Position of the coordinate in container pixels. */
  x: number;
  y: number;
  label: string;
}

export interface LayoutViewport {
  width: number;
  height: number;
  /** Pixels past each edge that still get a pill, so a small pan shows pills at once. */
  pad: number;
}

const CELL_W = 160;
const CELL_H = 64;

interface Box {
  l: number;
  r: number;
  t: number;
  b: number;
}

/**
 * Picks the pills. `points` come in priority order, highest first. Each point takes a pill if its
 * box is clear of every pill placed before it, and is a dot otherwise. A point far outside the
 * viewport is a dot, so the DOM holds only the pills a pan can reach.
 *
 * The pill box spans the tap area above the tip. A grid index keeps the check near O(n).
 */
export function layoutPricePills(
  points: readonly PinPoint[],
  viewport: LayoutViewport,
): Set<string> {
  const pills = new Set<string>();
  const grid = new Map<string, Box[]>();
  const cellOf = (x: number, y: number) =>
    [Math.floor(x / CELL_W), Math.floor(y / CELL_H)] as const;

  for (const point of points) {
    if (
      point.x < -viewport.pad ||
      point.y < -viewport.pad ||
      point.x > viewport.width + viewport.pad ||
      point.y > viewport.height + viewport.pad
    ) {
      continue;
    }
    const w = pillWidth(point.label);
    const box: Box = {
      l: point.x - w / 2,
      r: point.x + w / 2,
      t: point.y - (PILL_BODY_H + PILL_TAIL_H),
      b: point.y,
    };
    const [c0, r0] = cellOf(box.l - GAP, box.t - GAP);
    const [c1, r1] = cellOf(box.r + GAP, box.b + GAP);
    let clear = true;
    for (let c = c0; c <= c1 && clear; c++) {
      for (let r = r0; r <= r1 && clear; r++) {
        for (const other of grid.get(`${c},${r}`) ?? []) {
          if (
            box.l < other.r + GAP &&
            box.r + GAP > other.l &&
            box.t < other.b + GAP &&
            box.b + GAP > other.t
          ) {
            clear = false;
            break;
          }
        }
      }
    }
    if (!clear) continue;
    pills.add(point.id);
    // Register the box in every cell it touches, so a later box finds it from any cell.
    for (let c = c0; c <= c1; c++) {
      for (let r = r0; r <= r1; r++) {
        const key = `${c},${r}`;
        const cell = grid.get(key);
        if (cell) cell.push(box);
        else grid.set(key, [box]);
      }
    }
  }
  return pills;
}
