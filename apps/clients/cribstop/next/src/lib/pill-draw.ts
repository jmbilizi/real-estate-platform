import { PILL_BODY_H, PILL_HIT_TOP, PILL_TAIL_H, pillWidth } from './map-pins';

/**
 * Canvas drawing and hit geometry of one price pill (#549). Pure, so it runs under a recording
 * context in tests. The pill is drawn on the map's canvas, not as a DOM node, so 1,800 pills cost
 * one canvas and a pan moves it as one picture.
 */

export type PillState = 'plain' | 'saved' | 'active';

/** `micro-label` (12px/700) from DESIGN.md, in the app's own typeface. */
export const PILL_FONT = "700 12px 'Manrope Variable','Inter Variable',system-ui,sans-serif";

const BRAND = '#ff385c';
const RADIUS = PILL_BODY_H / 2;
const ACTIVE_SCALE = 1.1;
/** Room around a pill for its shadow and the hover ring, so a redraw clears all of it. */
const MARGIN = 14;

export interface PillGeometry {
  /** The body rectangle. */
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** The tail tip of the body. It is the true coordinate unless the body moved. */
  tailX: number;
  tailY: number;
  /** The true coordinate. */
  tipX: number;
  tipY: number;
}

/** The pill for a coordinate at (x, y) with its body offset by (dx, dy). Pixels in one space. */
export function pillGeometry(
  x: number,
  y: number,
  label: string,
  off: { dx: number; dy: number },
): PillGeometry {
  const w = pillWidth(label);
  const tailX = x + off.dx;
  const tailY = y + off.dy;
  return {
    left: tailX - w / 2,
    right: tailX + w / 2,
    bottom: tailY - PILL_TAIL_H,
    top: tailY - PILL_TAIL_H - PILL_BODY_H,
    tailX,
    tailY,
    tipX: x,
    tipY: y,
  };
}

/** Everything the pill can paint: body, tail, shadow, ring and leader line. */
export function pillBounds(g: PillGeometry): [number, number, number, number] {
  return [
    Math.min(g.left, g.tipX) - MARGIN,
    Math.min(g.top, g.tipY) - MARGIN,
    Math.max(g.right, g.tipX) + MARGIN,
    Math.max(g.tailY, g.tipY) + MARGIN,
  ];
}

/**
 * True when (px, py) hits the pill. With room around it, the hit area is the whole 44px box: the
 * body, 9px above it and the tail below. In a crowd it is the visible body and tail only, so a
 * hit is always on the pill that the user sees on top.
 */
export function pillContains(g: PillGeometry, roomy: boolean, px: number, py: number): boolean {
  if (px >= g.left && px <= g.right) {
    const top = roomy ? g.top - PILL_HIT_TOP : g.top;
    const bottom = roomy ? g.tailY : g.bottom;
    if (py >= top && py <= bottom) return true;
  }
  // The tail of a crowded pill.
  return Math.abs(px - g.tailX) <= 6 && py >= g.bottom && py <= g.tailY;
}

function bodyPath(ctx: CanvasRenderingContext2D, g: PillGeometry, grow: number, dropY = 0) {
  const l = g.left - grow;
  const t = g.top - grow + dropY;
  const r = g.right + grow;
  const b = g.bottom + grow + dropY;
  const rad = RADIUS + grow;
  ctx.beginPath();
  ctx.moveTo(l + rad, t);
  ctx.lineTo(r - rad, t);
  ctx.arcTo(r, t, r, t + rad, rad);
  ctx.lineTo(r, b - rad);
  ctx.arcTo(r, b, r - rad, b, rad);
  ctx.lineTo(l + rad, b);
  ctx.arcTo(l, b, l, b - rad, rad);
  ctx.lineTo(l, t + rad);
  ctx.arcTo(l, t, l + rad, t, rad);
  ctx.closePath();
}

/** Draws one pill. A pill that moved off its coordinate gets a leader line to the true point. */
export function drawPill(
  ctx: CanvasRenderingContext2D,
  g: PillGeometry,
  label: string,
  state: PillState,
): void {
  const red = state !== 'plain';
  const active = state === 'active';
  const moved = g.tailX !== g.tipX || g.tailY !== g.tipY;
  ctx.globalAlpha = 1;

  if (moved) {
    ctx.beginPath();
    ctx.moveTo(g.tailX, g.tailY);
    ctx.lineTo(g.tipX, g.tipY);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(34,34,34,0.4)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(g.tipX, g.tipY, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#222';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  }

  if (active) {
    ctx.save();
    ctx.translate(g.tailX, g.tailY);
    ctx.scale(ACTIVE_SCALE, ACTIVE_SCALE);
    ctx.translate(-g.tailX, -g.tailY);
    // The hover ring: red over white, so the pill still reads over a saved pill, which is red.
    bodyPath(ctx, g, 4);
    ctx.fillStyle = BRAND;
    ctx.fill();
    bodyPath(ctx, g, 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }

  // A shadow of the body, a little lower. A blurred canvas shadow is slow for 1,800 pills.
  bodyPath(ctx, g, 0, 1.5);
  ctx.fillStyle = 'rgba(34,34,34,0.22)';
  ctx.fill();

  const fill = red ? BRAND : '#fff';
  const stroke = red ? BRAND : 'rgba(0,0,0,0.2)';
  bodyPath(ctx, g, 0);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = stroke;
  ctx.stroke();

  // The tail, one path. Its fill hides the body border at the base, and its stroke is open, so
  // only the two slanted edges are drawn.
  const cx = g.tailX;
  ctx.beginPath();
  ctx.moveTo(cx - 6, g.bottom - 0.75);
  ctx.lineTo(cx, g.tailY);
  ctx.lineTo(cx + 6, g.bottom - 0.75);
  ctx.fill();
  ctx.stroke();

  ctx.font = PILL_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = red ? '#fff' : '#222';
  ctx.fillText(label, cx, (g.top + g.bottom) / 2 + 0.5);
  if (active) ctx.restore();
}
