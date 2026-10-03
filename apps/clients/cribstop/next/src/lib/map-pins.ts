/** Pin and price pill geometry and the same-coordinate fan for the listing map (#546, #549, #557). */

/** Pill body height in px. */
export const PILL_BODY_H = 28;
/** Height of the pointer tail under the pill body. The tail tip sits on the coordinate. */
export const PILL_TAIL_H = 7;
export const PILL_MIN_W = 44;
const PILL_PAD_X = 10;
const CHAR_W = 7.4;

/** Width of the pill body for a label. Never below `PILL_MIN_W`. */
export function pillWidth(label: string): number {
  return Math.max(PILL_MIN_W, Math.round(label.length * CHAR_W) + PILL_PAD_X * 2);
}

/** Homes at one true coordinate fan out from this zoom up, never below it. */
export const FAN_MIN_ZOOM = 17;
/** About 1.1 m: coordinates that agree to five decimals are one true coordinate. */
export const coordKeyOf = (latitude: number, longitude: number) =>
  `${latitude.toFixed(5)},${longitude.toFixed(5)}`;

/** Rings of spots around a shared coordinate: 3 rings, 44 spots, 64px at most (#554). */
const RINGS = [
  { radius: 24, count: 8 },
  { radius: 44, count: 14 },
  { radius: 64, count: 22 },
] as const;
export const FAN_CAP_PX = RINGS[RINGS.length - 1].radius;

export interface FanPoint {
  id: string;
  coordKey: string;
}

/**
 * Offsets for homes that share one true coordinate. The first home by id stays on the coordinate
 * and the others take spots on rings around it. A home past the last spot stays on the
 * coordinate. A home alone at its coordinate gets no entry.
 */
export function fanOffsets(points: readonly FanPoint[]): Map<string, { dx: number; dy: number }> {
  const groups = new Map<string, string[]>();
  for (const { id, coordKey } of points) {
    const group = groups.get(coordKey);
    if (group) group.push(id);
    else groups.set(coordKey, [id]);
  }
  const offsets = new Map<string, { dx: number; dy: number }>();
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    ids.sort();
    let at = 1;
    for (const { radius, count } of RINGS) {
      for (let i = 0; i < count && at < ids.length; i++, at++) {
        const angle = -Math.PI / 2 + (2 * Math.PI * i) / count;
        offsets.set(ids[at], {
          dx: Math.round(radius * Math.cos(angle)),
          dy: Math.round(radius * Math.sin(angle)),
        });
      }
    }
  }
  return offsets;
}
