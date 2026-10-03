/** Price pill geometry and overlap layout for the listing map (#546, #549). Pure, no Leaflet. */

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

/** Width of the pill icon box for a label. Never below the 44px tap target. */
export function pillWidth(label: string): number {
  return Math.max(PILL_MIN_W, Math.round(label.length * CHAR_W) + PILL_PAD_X * 2);
}

/** Body centre height above the tail tip. */
const BODY_CENTRE_ABOVE_TIP = PILL_BOX_H - PILL_HIT_TOP - PILL_BODY_H / 2;

/** Each overlapped pill keeps at least this many px of body in view. */
export const VISIBLE_STRIP = 14;
/** Two bodies may overlap in x by this share of the narrower one and still not need a step. */
const X_OVERLAP_OK = 0.3;
/** The hit area grows by this much above and below a body that has room (28 + 2 x 8 = 44px). */
export const HIT_EXTRA = 8;

export interface SpreadPoint {
  id: string;
  /** Tail tip position in map pixels. */
  x: number;
  y: number;
  label: string;
  /** The same value for homes at one true coordinate, about 1 to 2 m. Needed to fan them out. */
  coordKey?: string;
}

export interface PillOffset {
  /** Body offset from its own tail tip. The tail tip never moves. */
  dx: number;
  dy: number;
  /** True when no other body is within `HIT_EXTRA`, so the full 44px hit area is free. */
  roomy: boolean;
  /** Place in the stack, 0 on top. Leaflet's own order (screen y) is the same order. */
  rank: number;
}

export interface SpreadOptions {
  /** Homes that share a true coordinate fan out onto arcs. It is on only at a high zoom. */
  fan?: boolean;
}

type Spot = readonly [number, number];

/**
 * A body moves at most this far from its tail tip, in px, unless its home shares a true coordinate
 * with another and the zoom is high. Past the cap, pills overlap. A leader line is never longer.
 */
export const OFFSET_CAP_PX = 28;
/** Arcs for homes at one true coordinate: 3 rings, 27 spots, 136px at most. */
const MAX_RINGS = 3;
export const FAN_CAP_PX = 64 + 36 * (MAX_RINGS - 1);
/** The most rects one query reads, so thousands of pills on a few pixels cost a bounded amount. */
const MAX_POOL = 80;
const MAX_PER_CELL = 40;

/**
 * Where a body may sit, in the order tried: on the tip, two steps up, then arcs of growing radius
 * over the tip. The arc spots let many homes at one coordinate fan out. Each group lists the
 * farthest reach of its spots, so a pill reads its neighbours once per group.
 */
const SPOT_GROUPS: ReadonlyArray<{ reach: number; spots: Spot[] }> = (() => {
  const groups: Array<{ reach: number; spots: Spot[] }> = [
    {
      reach: 2 * VISIBLE_STRIP,
      spots: [
        [0, 0],
        [0, -VISIBLE_STRIP],
        [0, -2 * VISIBLE_STRIP],
      ],
    },
  ];
  for (let ring = 0; ring < MAX_RINGS; ring++) {
    const radius = 64 + 36 * ring;
    const count = 6 + 3 * ring;
    const spots: Spot[] = [];
    // Upper half circle, from the top outward on alternate sides.
    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const step = Math.ceil(i / 2);
      const angle = Math.PI / 2 - (side * step * Math.PI) / count;
      spots.push([Math.round(radius * Math.cos(angle)), -Math.round(radius * Math.sin(angle))]);
    }
    groups.push({ reach: radius, spots });
  }
  return groups;
})();

interface Rect {
  cx: number;
  cy: number;
  w: number;
  /** Query stamp, so a rect in many grid cells is read once per query. */
  seen: number;
}

const CELL_W = 80;
const CELL_H = 32;
const HALF_H = PILL_BODY_H / 2;

/**
 * Lays out the pill bodies so that no body is hidden. Pills may overlap. Each pill keeps
 * `VISIBLE_STRIP` px of its body uncovered, and the tail tip stays on the coordinate.
 *
 * Pills place in stacking order, top pill first, so each pill only needs room against the pills
 * above it. The top pill stays on its tip. A pill that would be covered steps up, and then moves
 * to an arc over the tip. Homes at one coordinate fan out this way and never fuse, at any zoom.
 * The result depends on the point set and the zoom only, so a pan does not reshuffle it.
 */
export function createPillSpreader(
  points: readonly SpreadPoint[],
  options: SpreadOptions = {},
): PillSpreader {
  const order = [...points].sort((a, b) => b.y - a.y || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const grid = new Map<number, Rect[]>();
  // A cell index stays below 2^25 in magnitude at any zoom, so the key is unique.
  const key = (c: number, r: number) => (c + 33_554_432) * 67_108_864 + (r + 33_554_432);
  let stamp = 0;

  /** Placed rects whose cells touch the box of half size (hw, hh) around (cx, cy). */
  const near = (cx: number, cy: number, hw: number, hh: number): Rect[] => {
    stamp++;
    const found: Rect[] = [];
    const c1 = Math.floor((cx + hw) / CELL_W);
    const r1 = Math.floor((cy + hh) / CELL_H);
    for (let c = Math.floor((cx - hw) / CELL_W); c <= c1; c++) {
      for (let r = Math.floor((cy - hh) / CELL_H); r <= r1; r++) {
        const cell = grid.get(key(c, r));
        if (!cell) continue;
        // The newest rects of a crowded cell. The older ones are far below in the stack.
        for (let i = Math.max(0, cell.length - MAX_PER_CELL); i < cell.length; i++) {
          const rect = cell[i];
          if (rect.seen === stamp) continue;
          rect.seen = stamp;
          found.push(rect);
          if (found.length >= MAX_POOL) return found;
        }
      }
    }
    return found;
  };
  const add = (rect: Rect) => {
    const c1 = Math.floor((rect.cx + rect.w / 2) / CELL_W);
    const r1 = Math.floor((rect.cy + HALF_H) / CELL_H);
    for (let c = Math.floor((rect.cx - rect.w / 2) / CELL_W); c <= c1; c++) {
      for (let r = Math.floor((rect.cy - HALF_H) / CELL_H); r <= r1; r++) {
        const k = key(c, r);
        const cell = grid.get(k);
        if (cell) cell.push(rect);
        else grid.set(k, [rect]);
      }
    }
  };

  // Placed homes per true coordinate. Only a true crowd fans out.
  const coordCount = new Map<string, number>();

  /** True when a body at (cx, cy) keeps its visible strip against every pill above it. */
  const fits = (
    cx: number,
    cy: number,
    w: number,
    pool: readonly Rect[],
    strict = true,
  ): boolean => {
    // The pool covers every spot of a group. Only the few rects near this spot matter.
    const touchingRects: Rect[] = [];
    for (const o of pool) {
      if (Math.abs(cy - o.cy) < PILL_BODY_H + 2 && Math.abs(cx - o.cx) < (w + o.w) / 2 + 2) {
        touchingRects.push(o);
      }
    }
    const touching = touchingRects.length;
    for (const o of touchingRects) {
      const xOverlap = (w + o.w) / 2 - Math.abs(cx - o.cx);
      if (
        strict &&
        xOverlap > X_OVERLAP_OK * Math.min(w, o.w) &&
        Math.abs(cy - o.cy) < VISIBLE_STRIP
      ) {
        return false;
      }
    }
    // Two pills can cover a third from both sides. Some spot of the body must stay in view.
    if (touching < (strict ? 2 : 1)) return true;
    let open = 0;
    for (const fx of [-0.36, -0.12, 0.12, 0.36]) {
      for (const fy of [-0.3, 0, 0.3]) {
        const px = cx + fx * w;
        const py = cy + fy * PILL_BODY_H;
        let covered = false;
        for (const o of touchingRects) {
          if (Math.abs(px - o.cx) <= o.w / 2 + 1 && Math.abs(py - o.cy) <= HALF_H + 1) {
            covered = true;
            break;
          }
        }
        if (!covered && ++open >= (strict ? 3 : 2)) return true;
      }
    }
    return false;
  };

  const result = new Map<string, PillOffset>();
  const placed: Array<{ id: string; rect: Rect }> = [];
  const place = (point: SpreadPoint, rank: number): [string, PillOffset] => {
    const w = pillWidth(point.label);
    const baseX = point.x;
    const baseY = point.y - BODY_CENTRE_ABOVE_TIP;
    let dx = 0;
    let dy = 0;
    let found = false;
    // Only a pill that shares its spot with a placed pill may move far. Elsewhere a pill steps up
    // twice at most. Pills of a dense area at low zoom then overlap, and the next zoom sorts them.
    const crowd = options.fan && point.coordKey ? (coordCount.get(point.coordKey) ?? 0) : 0;
    let capacity = 0;
    for (const group of SPOT_GROUPS) {
      // Search only as far as the crowd needs: a spot count of twice the crowd, plus a margin.
      if (group.reach > OFFSET_CAP_PX && (crowd === 0 || capacity >= 2 * crowd + 6)) break;
      capacity += group.spots.length;
      const pool = near(baseX, baseY, w / 2 + group.reach, HALF_H + group.reach);
      for (const [sx, sy] of group.spots) {
        if (!fits(baseX + sx, baseY + sy, w, pool)) continue;
        dx = sx;
        dy = sy;
        found = true;
        break;
      }
      if (found) break;
    }
    if (!found) {
      // Take the nearest spot that leaves part of the body in view, even if its strip is short.
      for (const group of SPOT_GROUPS.slice(0, crowd > 0 ? SPOT_GROUPS.length : 1)) {
        const pool = near(baseX, baseY, w / 2 + group.reach, HALF_H + group.reach);
        for (const [sx, sy] of group.spots) {
          if (!fits(baseX + sx, baseY + sy, w, pool, false)) continue;
          dx = sx;
          dy = sy;
          found = true;
          break;
        }
        if (found) break;
      }
    }
    const rect: Rect = { cx: baseX + dx, cy: baseY + dy, w, seen: 0 };
    add(rect);
    if (options.fan && point.coordKey) {
      coordCount.set(point.coordKey, (coordCount.get(point.coordKey) ?? 0) + 1);
    }
    placed.push({ id: point.id, rect });
    const offset: PillOffset = { dx, dy, roomy: true, rank };
    result.set(point.id, offset);
    return [point.id, offset];
  };

  // A pill keeps the full 44px hit area only when no other body is within the extra reach. That
  // needs every pill placed, so it is a second pass.
  let roomyAt = 0;
  const nextRoomy = (): [string, boolean] | null => {
    const item = placed[roomyAt++];
    if (!item) return null;
    const { id, rect } = item;
    const crowded = near(rect.cx, rect.cy, rect.w / 2, HALF_H + HIT_EXTRA).some(
      (o) =>
        o !== rect &&
        (rect.w + o.w) / 2 - Math.abs(rect.cx - o.cx) > 0 &&
        Math.abs(rect.cy - o.cy) < PILL_BODY_H + HIT_EXTRA,
    );
    if (crowded) (result.get(id) as PillOffset).roomy = false;
    return [id, !crowded];
  };

  let rankAt = 0;
  return {
    total: order.length,
    next: () => (rankAt < order.length ? place(order[rankAt], rankAt++) : null),
    nextRoomy,
    result,
  };
}

/**
 * The same layout as `spreadPills`, one pill at a time. The layer calls `next` until its time
 * budget ends and then yields, so 1,800 pills never hold the main thread for one long task.
 * `nextRoomy` runs after `next` returns null.
 */
export interface PillSpreader {
  total: number;
  next: () => [string, PillOffset] | null;
  nextRoomy: () => [string, boolean] | null;
  result: Map<string, PillOffset>;
}

export function spreadPills(
  points: readonly SpreadPoint[],
  options: SpreadOptions = {},
): Map<string, PillOffset> {
  const spreader = createPillSpreader(points, options);
  while (spreader.next());
  while (spreader.nextRoomy());
  return spreader.result;
}
