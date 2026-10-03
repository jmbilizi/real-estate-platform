import { PILL_BODY_H, PILL_TAIL_H, pillWidth } from './map-pins';

/**
 * Canvas drawing and hit geometry of one home on the search map (#557). At rest a home is a small
 * teardrop pin. A hovered or selected home is a red price pill. Both draw on the map's canvas, not
 * as DOM nodes, so 1,800 homes cost one canvas and a pan moves it as one picture. Pure, so it runs
 * under a recording context in tests.
 */

export type PinState = 'plain' | 'saved' | 'active';

/** `micro-label` (12px/700) from DESIGN.md, in the app's own typeface. */
export const PILL_FONT = "700 12px 'Manrope Variable','Inter Variable',system-ui,sans-serif";

const BRAND = '#ff385c';
const BRAND_DARK = '#8f0f2a';
const PILL_RADIUS = PILL_BODY_H / 2;
const ACTIVE_SCALE = 1.1;
/** Room around a drawing for its shadow and ring, so a redraw clears all of it. */
const MARGIN = 14;

/** Teardrop size in px. */
export const PIN_W = 13;
export const PIN_H = 19;
const PIN_R = PIN_W / 2;
/** Hit box of a pin: 24 wide, 28 tall, from 26px above the tip to 2px below it. */
const HIT_HALF_W = 12;
const HIT_ABOVE = 26;
const HIT_BELOW = 2;
/** Height of the popup anchor above a tip, so the popup clears the pill. */
export const PILL_ANCHOR_H = PILL_BODY_H + PILL_TAIL_H + 6;

export interface PinGeometry {
  /** Where the pin tip or pill tail tip sits. It is the true coordinate unless the home fanned out. */
  tipX: number;
  tipY: number;
  /** The true coordinate. */
  x: number;
  y: number;
}

/** The pin for a coordinate at (x, y) with its tip offset by (dx, dy). Pixels in one space. */
export function pinGeometry(
  x: number,
  y: number,
  off: { dx: number; dy: number } = { dx: 0, dy: 0 },
): PinGeometry {
  return { tipX: x + off.dx, tipY: y + off.dy, x, y };
}

interface PillBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function pillBox(g: PinGeometry, label: string): PillBox {
  const w = pillWidth(label);
  const bottom = g.tipY - PILL_TAIL_H;
  return { left: g.tipX - w / 2, right: g.tipX + w / 2, top: bottom - PILL_BODY_H, bottom };
}

/** Everything the home can paint in its state: shape, shadow, ring and leader line. */
export function pinBounds(
  g: PinGeometry,
  label: string,
  active: boolean,
): [number, number, number, number] {
  let left = g.tipX - HIT_HALF_W;
  let right = g.tipX + HIT_HALF_W;
  let top = g.tipY - HIT_ABOVE;
  if (active) {
    const box = pillBox(g, label);
    left = Math.min(left, box.left);
    right = Math.max(right, box.right);
    top = Math.min(top, box.top);
  }
  return [
    Math.min(left, g.x) - MARGIN,
    Math.min(top, g.y) - MARGIN,
    Math.max(right, g.x) + MARGIN,
    Math.max(g.tipY, g.y) + MARGIN,
  ];
}

/**
 * True when (px, py) hits the home. The hit area is the 24x28 box of the pin. An active home also
 * hits on its pill, so a pointer that moves from the pin onto the pill does not drop the hover.
 */
export function pinContains(
  g: PinGeometry,
  label: string,
  active: boolean,
  px: number,
  py: number,
): boolean {
  if (Math.abs(px - g.tipX) <= HIT_HALF_W && py >= g.tipY - HIT_ABOVE && py <= g.tipY + HIT_BELOW) {
    return true;
  }
  if (!active) return false;
  const box = pillBox(g, label);
  return px >= box.left && px <= box.right && py >= box.top && py <= g.tipY;
}

/** A home that fanned out gets a line and a dot on its true coordinate. */
function drawLeader(ctx: CanvasRenderingContext2D, g: PinGeometry) {
  if (g.tipX === g.x && g.tipY === g.y) return;
  ctx.beginPath();
  ctx.moveTo(g.tipX, g.tipY);
  ctx.lineTo(g.x, g.y);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(34,34,34,0.4)';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(g.x, g.y, 3, 0, Math.PI * 2);
  ctx.fillStyle = '#222';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
}

/** The teardrop: a circle on top, two tangent lines down to the tip. */
function drawPin(ctx: CanvasRenderingContext2D, g: PinGeometry, saved: boolean) {
  const cy = g.tipY - (PIN_H - PIN_R);
  // The tangent points sit this far from straight down, seen from the circle centre.
  const spread = Math.acos(PIN_R / (PIN_H - PIN_R));
  ctx.beginPath();
  ctx.moveTo(g.tipX, g.tipY);
  ctx.lineTo(g.tipX + PIN_R * Math.sin(spread), cy + PIN_R * Math.cos(spread));
  ctx.arc(g.tipX, cy, PIN_R, Math.PI / 2 - spread, Math.PI / 2 + spread, true);
  ctx.closePath();
  ctx.fillStyle = saved ? BRAND_DARK : BRAND;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(g.tipX, cy, 2.4, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
}

function bodyPath(ctx: CanvasRenderingContext2D, b: PillBox, grow: number, dropY = 0) {
  const l = b.left - grow;
  const t = b.top - grow + dropY;
  const r = b.right + grow;
  const bt = b.bottom + grow + dropY;
  const rad = PILL_RADIUS + grow;
  ctx.beginPath();
  ctx.moveTo(l + rad, t);
  ctx.lineTo(r - rad, t);
  ctx.arcTo(r, t, r, t + rad, rad);
  ctx.lineTo(r, bt - rad);
  ctx.arcTo(r, bt, r - rad, bt, rad);
  ctx.lineTo(l + rad, bt);
  ctx.arcTo(l, bt, l, bt - rad, rad);
  ctx.lineTo(l, t + rad);
  ctx.arcTo(l, t, l + rad, t, rad);
  ctx.closePath();
}

/** The red price pill of a hovered or selected home. Its tail tip is on the coordinate. */
function drawPill(ctx: CanvasRenderingContext2D, g: PinGeometry, label: string) {
  const b = pillBox(g, label);
  ctx.save();
  ctx.translate(g.tipX, g.tipY);
  ctx.scale(ACTIVE_SCALE, ACTIVE_SCALE);
  ctx.translate(-g.tipX, -g.tipY);
  // A white ring, so the pill reads over the red pins under it.
  bodyPath(ctx, b, 4);
  ctx.fillStyle = BRAND;
  ctx.fill();
  bodyPath(ctx, b, 2);
  ctx.fillStyle = '#fff';
  ctx.fill();

  // A shadow of the body, a little lower. A blurred canvas shadow is slow for 1,800 homes.
  bodyPath(ctx, b, 0, 1.5);
  ctx.fillStyle = 'rgba(34,34,34,0.22)';
  ctx.fill();

  bodyPath(ctx, b, 0);
  ctx.fillStyle = BRAND;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = BRAND;
  ctx.stroke();

  // The tail, one path. Its fill hides the body border at the base, and its stroke is open, so
  // only the two slanted edges are drawn.
  ctx.beginPath();
  ctx.moveTo(g.tipX - 6, b.bottom - 0.75);
  ctx.lineTo(g.tipX, g.tipY);
  ctx.lineTo(g.tipX + 6, b.bottom - 0.75);
  ctx.fill();
  ctx.stroke();

  ctx.font = PILL_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.fillText(label, g.tipX, (b.top + b.bottom) / 2 + 0.5);
  ctx.restore();
}

/** Draws one home. Only an active home draws text, and the text is its price. */
export function drawHome(
  ctx: CanvasRenderingContext2D,
  g: PinGeometry,
  label: string,
  state: PinState,
): void {
  ctx.globalAlpha = 1;
  drawLeader(ctx, g);
  if (state === 'active') drawPill(ctx, g, label);
  else drawPin(ctx, g, state === 'saved');
}
