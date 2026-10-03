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

type Spot = readonly [number, number];

/** Arcs reach 6 rings, 81 spots, enough for a building of units at one coordinate. */
const MAX_RINGS = 6;
/** Tails closer than this share a spot. Only such a crowd fans out onto arcs. */
const SAME_SPOT_PX = 3;
/** A pill with no spot of its own strip may still take a spot in the first rings, to stay in view. */
const RELAXED_GROUPS = 4;

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
export function createPillSpreader(points: readonly SpreadPoint[]): PillSpreader {
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
        for (const rect of cell) {
          if (rect.seen === stamp) continue;
          rect.seen = stamp;
          found.push(rect);
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

  // Placed tail tips by cell, to tell whether a pill shares its spot with a placed pill.
  const tips = new Map<number, Array<[number, number]>>();
  const addTip = (x: number, y: number) => {
    const k = key(Math.floor(x / SAME_SPOT_PX), Math.floor(y / SAME_SPOT_PX));
    const cell = tips.get(k);
    if (cell) cell.push([x, y]);
    else tips.set(k, [[x, y]]);
  };
  const tipCrowd = (x: number, y: number): number => {
    let count = 0;
    const c = Math.floor(x / SAME_SPOT_PX);
    const r = Math.floor(y / SAME_SPOT_PX);
    for (let i = c - 1; i <= c + 1; i++) {
      for (let j = r - 1; j <= r + 1; j++) {
        for (const [tx, ty] of tips.get(key(i, j)) ?? []) {
          if (Math.abs(tx - x) < SAME_SPOT_PX && Math.abs(ty - y) < SAME_SPOT_PX) count++;
        }
      }
    }
    return count;
  };

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
    const crowd = tipCrowd(point.x, point.y);
    let capacity = 0;
    for (const group of SPOT_GROUPS) {
      // Search only as far as the crowd needs: a spot count of twice the crowd, plus a margin.
      if (group.reach > 2 * VISIBLE_STRIP && (crowd === 0 || capacity >= 2 * crowd + 6)) break;
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
      for (const group of SPOT_GROUPS.slice(0, RELAXED_GROUPS)) {
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
    // A crowd past the last arc climbs in a column. Its pills sit far from their tips, none hidden.
    for (let j = 3; !found && j < 40; j++) {
      const pool = near(baseX, baseY - j * VISIBLE_STRIP, w / 2, HALF_H + VISIBLE_STRIP);
      if (fits(baseX, baseY - j * VISIBLE_STRIP, w, pool)) {
        dy = -j * VISIBLE_STRIP;
        found = true;
      }
    }
    const rect: Rect = { cx: baseX + dx, cy: baseY + dy, w, seen: 0 };
    add(rect);
    addTip(point.x, point.y);
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

export function spreadPills(points: readonly SpreadPoint[]): Map<string, PillOffset> {
  const spreader = createPillSpreader(points);
  while (spreader.next());
  while (spreader.nextRoomy());
  return spreader.result;
}
