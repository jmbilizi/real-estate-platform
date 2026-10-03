'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { createRoot, type Root } from 'react-dom/client';
import { Provider } from 'react-redux';
import type { MapPin } from '@cribstop/property-contracts';
import MapPinCard from '@/components/MapPinCard';
import { store } from '@/lib/store/store';
import type { ListingCardRow } from '@/lib/types';
import { formatListingPriceShort } from '@/lib/listing-format';
import { createPillSpreader, PILL_BOX_H, type PillOffset, type SpreadPoint } from '@/lib/map-pins';
import {
  drawPill,
  PILL_FONT,
  pillBounds,
  pillContains,
  pillGeometry,
  type PillState,
} from '@/lib/pill-draw';

/**
 * Popup width in px. A phone map pane is about 350px tall, so the narrower card keeps the popup
 * inside it. Keep equal to the wrapper width classes below.
 */
const popupWidth = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(min-width: 640px)').matches ? 280 : 232;

/** The parts of Leaflet's canvas renderer that this layer drives. */
interface PillRenderer extends L.Canvas {
  _drawing: boolean;
  _ctx: CanvasRenderingContext2D;
  _extendRedrawBounds: (layer: L.Layer) => void;
  _requestRedraw: (layer: L.Layer) => void;
  _redraw: () => void;
  _redrawRequest: number | null;
  _container?: HTMLCanvasElement;
}

/** Before the first layout. Its rank never matches a real one, so the first layout always writes. */
const NO_OFFSET: PillOffset = { dx: 0, dy: 0, roomy: false, rank: -1 };

/**
 * One home as a price pill on the shared canvas (#549). The renderer draws it and finds the pill
 * under the pointer, and a layer later in its draw order is on top. The pill is a picture, so 1,800
 * of them cost one canvas and a pan moves that canvas as one piece.
 */
class PillLayer extends L.CircleMarker {
  readonly pin: MapPin;
  readonly label: string;
  state: PillState = 'plain';
  spread: PillOffset = NO_OFFSET;

  constructor(pin: MapPin, renderer: L.Renderer) {
    super([pin.latitude, pin.longitude], {
      renderer,
      radius: 1,
      stroke: false,
      fill: false,
      interactive: true,
      bubblingMouseEvents: false,
    });
    this.pin = pin;
    this.label = formatListingPriceShort(pin.price, pin.listingType).text;
  }

  /** The pill for the projected position. `_point` is in layer pixels, the canvas's own space. */
  geometry() {
    const { x, y } = (this as unknown as { _point: L.Point })._point;
    return pillGeometry(x, y, this.label, this.spread);
  }

  // Leaflet calls these three. They replace the circle's own bounds, hit test and drawing.
  _updateBounds() {
    const [minX, minY, maxX, maxY] = pillBounds(this.geometry());
    (this as unknown as { _pxBounds: L.Bounds })._pxBounds = L.bounds(
      L.point(minX, minY),
      L.point(maxX, maxY),
    );
  }

  _containsPoint(point: L.Point) {
    return pillContains(this.geometry(), this.spread.roomy, point.x, point.y);
  }

  _updatePath() {
    const renderer = (this as unknown as { _renderer: PillRenderer })._renderer;
    if (!renderer._drawing) return;
    drawPill(renderer._ctx, this.geometry(), this.label, this.state);
  }
}

/** The renderer that draws a pill. It is set once the pill is on the map. */
const rendererOf = (layer: PillLayer) =>
  (layer as unknown as { _renderer?: PillRenderer })._renderer;

/** Repaints a pill. The old bounds are cleared and the new ones drawn, as Leaflet's own update does. */
function repaint(layer: PillLayer) {
  const renderer = rendererOf(layer);
  if (!renderer) return;
  renderer._extendRedrawBounds(layer);
  layer._updateBounds();
  renderer._requestRedraw(layer);
}

/**
 * Draw order, first drawn first. A hovered or active pill is last, so on top. The rest go by screen
 * y, so a lower pill covers a higher one. That is the order the spread plans for. The order
 * depends only on state and position, so a pan does not reshuffle it.
 */
// Saved is drawn like plain: a raised pill could cover the strip that the spread kept for another.
const STATE_ORDER: Record<PillState, number> = { plain: 0, saved: 0, active: 1 };
const pointY = (l: PillLayer) => (l as unknown as { _point?: L.Point })._point?.y ?? 0;
const byDrawOrder = (a: PillLayer, b: PillLayer) =>
  STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
  pointY(a) - pointY(b) ||
  (a.pin.id < b.pin.id ? 1 : a.pin.id > b.pin.id ? -1 : 0);

interface DrawNode {
  layer: PillLayer;
  prev: DrawNode | null;
  next: DrawNode | null;
}
type OrderedRenderer = PillRenderer & { _drawFirst: DrawNode | null; _drawLast: DrawNode | null };

/**
 * Moves one pill after `anchor` in the renderer's draw list, or to the front. Leaflet has only
 * "to front" and "to back", and a hover must put a pill back where it was, not at the end.
 */
function moveAfter(layer: PillLayer, anchor: PillLayer | null) {
  const renderer = rendererOf(layer) as OrderedRenderer | undefined;
  const node = (layer as unknown as { _order?: DrawNode })._order;
  if (!renderer || !node) return;
  const anchorNode = anchor ? (anchor as unknown as { _order?: DrawNode })._order : null;
  if (anchor && !anchorNode) return;
  if ((anchorNode ?? null) === node.prev) return;
  if (node.prev) node.prev.next = node.next;
  else renderer._drawFirst = node.next;
  if (node.next) node.next.prev = node.prev;
  else renderer._drawLast = node.prev;
  if (anchorNode) {
    node.prev = anchorNode;
    node.next = anchorNode.next;
    if (anchorNode.next) anchorNode.next.prev = node;
    else renderer._drawLast = node;
    anchorNode.next = node;
  } else {
    node.prev = null;
    node.next = renderer._drawFirst;
    if (renderer._drawFirst) renderer._drawFirst.prev = node;
    renderer._drawFirst = node;
    renderer._drawLast ??= node;
  }
  renderer._requestRedraw(layer);
}

/** Puts one pill at its place in the draw order. The sorted list stays sorted. */
function restackOne(ctx: Ctx, layer: PillLayer) {
  const at = ctx.order.indexOf(layer);
  if (at >= 0) ctx.order.splice(at, 1);
  let lo = 0;
  let hi = ctx.order.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (byDrawOrder(ctx.order[mid], layer) < 0) lo = mid + 1;
    else hi = mid;
  }
  ctx.order.splice(lo, 0, layer);
  moveAfter(layer, ctx.order[lo - 1] ?? null);
}

/** Puts every pill in order. It is for a big change, such as the first fetch. */
function restackAll(ctx: Ctx) {
  ctx.order.sort(byDrawOrder);
  for (const layer of ctx.order) layer.bringToFront();
}

/** More new pills than this are put in order in one pass, not one by one. */
const BULK_RESTACK = 40;
/** Homes at one true coordinate fan out from this zoom up, never below it. */
export const FAN_MIN_ZOOM = 17;
/** About 1.1 m: coordinates that agree to five decimals are one true coordinate. */
const coordKeyOf = (pin: MapPin) => `${pin.latitude.toFixed(5)},${pin.longitude.toFixed(5)}`;

/** Up to this many pills the layout runs in one go. Beyond it, it runs in slices. */
const SYNC_LAYOUT_MAX = 250;
/** The longest one slice of a layout holds the main thread, in ms. */
const SLICE_MS = 8;
/** How long a zoom waits for the pin refetch before it lays out the pills it has. */
const ZOOM_LAYOUT_DELAY_MS = 250;

interface Ctx {
  group: L.FeatureGroup;
  layers: Map<string, PillLayer>;
  /** The pills in draw order, first drawn first. */
  order: PillLayer[];
  /** The points of the last layout, to skip a layout that would give the same result. */
  signature: Map<string, string> | null;
  /** A zoom layout waiting for the refetch that follows it. */
  timer: ReturnType<typeof setTimeout> | null;
  /** The running layout. A newer layout bumps it, and the older one stops. */
  layoutRun: number;
  slice: ReturnType<typeof setTimeout> | null;
  /** The pill under the pointer. */
  hovered: string | null;
}

/**
 * Writes one pill's body offset and marks its old and new bounds for the redraw. The layout asks
 * for one redraw when it ends, not one per pill.
 */
function writeOffset(layer: PillLayer, next: PillOffset) {
  const prev = layer.spread;
  if (next.dx === prev.dx && next.dy === prev.dy && next.rank === prev.rank) return;
  const renderer = rendererOf(layer);
  renderer?._extendRedrawBounds(layer);
  // The full hit area waits for the second pass, which knows every neighbour.
  layer.spread = { ...next, roomy: false };
  layer._updateBounds();
  renderer?._extendRedrawBounds(layer);
}

/**
 * Spreads the bodies of overlapping pills (see `createPillSpreader`). The tail tip stays on the
 * coordinate, and a moved pill draws a leader line from its tail to that tip. A big layout runs
 * in slices of `SLICE_MS`, so it never holds the main thread for long. A newer layout cancels an
 * older one that is still running.
 */
function layoutPills(map: L.Map, ctx: Ctx) {
  const zoom = map.getZoom();
  const fan = zoom >= FAN_MIN_ZOOM;
  const points: SpreadPoint[] = [];
  const signature = new Map<string, string>();
  for (const layer of ctx.layers.values()) {
    const p = map.project(layer.getLatLng(), zoom);
    points.push({
      id: layer.pin.id,
      x: p.x,
      y: p.y,
      label: layer.label,
      coordKey: coordKeyOf(layer.pin),
    });
    signature.set(layer.pin.id, `${p.x},${p.y},${layer.label},${fan}`);
  }
  // The same points at the same zoom give the same spread, and a layout for them may be running.
  const last = ctx.signature;
  if (last && last.size === signature.size) {
    let same = true;
    for (const [id, sig] of signature) {
      if (last.get(id) !== sig) {
        same = false;
        break;
      }
    }
    if (same) return;
  }
  ctx.signature = signature;
  ctx.layoutRun += 1;
  const run = ctx.layoutRun;
  if (ctx.slice) clearTimeout(ctx.slice);
  ctx.slice = null;

  const spreader = createPillSpreader(points, { fan });
  let placing = true;
  const step = (): boolean => {
    if (placing) {
      const item = spreader.next();
      if (item) {
        const layer = ctx.layers.get(item[0]);
        if (layer) writeOffset(layer, item[1]);
        return true;
      }
      placing = false;
    }
    const item = spreader.nextRoomy();
    if (!item) {
      const any = ctx.order[0];
      if (any) rendererOf(any)?._requestRedraw(any);
      return false;
    }
    const layer = ctx.layers.get(item[0]);
    if (layer) layer.spread = { ...layer.spread, roomy: item[1] };
    return true;
  };

  if (points.length <= SYNC_LAYOUT_MAX) {
    while (step());
    return;
  }
  const slice = () => {
    ctx.slice = null;
    if (run !== ctx.layoutRun) return;
    const start = performance.now();
    while (performance.now() - start < SLICE_MS) {
      if (!step()) return;
    }
    ctx.slice = setTimeout(slice, 0);
  };
  slice();
}

/**
 * Every home as a price pill at its exact coordinate (#546, #549). There are no clusters and no
 * dots. Pills that overlap stack. The hovered or active pill is on top, then saved pills, then the
 * rest in screen order.
 *
 * The pills are drawn on one canvas. A fetch is diffed against the pills on the map, so a pan adds
 * and removes only the pills that changed, and a hover or save change repaints one or two pills.
 */
export default function PricePinLayer({
  pins,
  rowsById,
  activeId,
  savedIds,
  onMarkerHover,
}: {
  pins: readonly MapPin[];
  /** The current results page. A pin for one of these rows shows the row it already has. */
  rowsById: ReadonlyMap<string, ListingCardRow>;
  activeId: string | null;
  savedIds?: ReadonlySet<string>;
  onMarkerHover?: (id: string | null) => void;
}) {
  const map = useMap();
  const renderer = useMemo(() => L.canvas({ padding: 0.5 }), []);
  const cb = useRef({ onMarkerHover, rowsById });
  cb.current = { onMarkerHover, rowsById };
  const view = useRef({ activeId, savedIds });
  view.current = { activeId, savedIds };
  const ctxRef = useRef<Ctx | null>(null);
  const popupRef = useRef<{ popup: L.Popup; root: Root } | null>(null);

  const closeCard = useCallback(() => {
    const open = popupRef.current;
    if (!open) return;
    popupRef.current = null;
    map.closePopup(open.popup);
    // The root renders inside Leaflet's own commit, so unmount after it.
    setTimeout(() => open.root.unmount(), 0);
  }, [map]);

  /**
   * One popup for the whole layer, kept outside the pin effect. A pan refetches the pins and
   * opening a popup can itself pan the map. The popup must survive that.
   */
  const openCard = useCallback(
    (id: string, latlng: L.LatLng, offset: L.Point) => {
      closeCard();
      const el = document.createElement('div');
      const root = createRoot(el);
      let popup: L.Popup | null = null;
      // A card that loads after the popup opens changes its size. The popup measures again, so it
      // stays anchored and on screen.
      const onLayout = () => popup?.update();
      // The popup is its own React root, so it gets the store that `AppProvider` gives the page.
      // A pin off the results page has no row here, so the popup shows a loading state, then the
      // same card the grid shows.
      root.render(
        <Provider store={store}>
          <div className="w-[232px] bg-surface p-2 sm:w-[280px]">
            <MapPinCard key={id} id={id} row={cb.current.rowsById.get(id)} onLayout={onLayout} />
          </div>
        </Provider>,
      );
      popup = L.popup({
        closeButton: false,
        maxWidth: popupWidth(),
        minWidth: popupWidth(),
        autoPan: true,
        offset,
        // Keep the popup clear of the zoom controls (right) and the notice banner (top).
        autoPanPaddingTopLeft: L.point(16, 64),
        // On a phone the results sheet covers the bottom of the map, so the card stays above it.
        autoPanPaddingBottomRight: L.point(72, popupWidth() < 280 ? 88 : 16),
      })
        .setLatLng(latlng)
        .setContent(el);
      popupRef.current = { popup, root };
      popup.openOn(map);
    },
    [map, closeCard],
  );

  useEffect(() => {
    const onPopupClose = (event: L.PopupEvent) => {
      const open = popupRef.current;
      if (!open || open.popup !== event.popup) return;
      popupRef.current = null;
      setTimeout(() => open.root.unmount(), 0);
    };
    map.on('popupclose', onPopupClose);
    return () => {
      map.off('popupclose', onPopupClose);
      closeCard();
    };
  }, [map, closeCard]);

  /** Sets one pill's look and stack order. Only repaints when the state changed. */
  const applyState = useCallback((layer: PillLayer, ctx: Ctx) => {
    const { activeId: active, savedIds: saved } = view.current;
    const next: PillState =
      ctx.hovered === layer.pin.id || active === layer.pin.id
        ? 'active'
        : saved?.has(layer.pin.id)
          ? 'saved'
          : 'plain';
    if (next === layer.state) return false;
    layer.state = next;
    repaint(layer);
    return true;
  }, []);

  // One feature group for the layer. Event delegation keeps it to three handlers, not 5,400.
  useEffect(() => {
    const group = L.featureGroup().addTo(map);
    const ctx: Ctx = {
      group,
      layers: new Map(),
      order: [],
      signature: null,
      timer: null,
      layoutRun: 0,
      slice: null,
      hovered: null,
    };
    ctxRef.current = ctx;
    const find = (event: L.LeafletEvent) =>
      ctx.layers.get((event.propagatedFrom as PillLayer).pin.id);
    group.on('mouseover', (event) => {
      const layer = find(event);
      if (!layer) return;
      ctx.hovered = layer.pin.id;
      if (applyState(layer, ctx)) restackOne(ctx, layer);
      cb.current.onMarkerHover?.(layer.pin.id);
    });
    group.on('mouseout', (event) => {
      const layer = find(event);
      if (!layer) return;
      ctx.hovered = null;
      if (applyState(layer, ctx)) restackOne(ctx, layer);
      cb.current.onMarkerHover?.(null);
    });
    group.on('click', (event) => {
      const layer = find(event);
      if (!layer) return;
      // The popup opens above the body, which can sit away from its tail tip.
      const { dx, dy } = layer.spread;
      openCard(layer.pin.id, layer.getLatLng(), L.point(dx, dy - PILL_BOX_H - 4));
    });
    // The spread depends on the zoom. A pan only moves the canvas, so it needs no new layout.
    // A zoom also refetches the pins, and that fetch lays out again. The short wait lets it go
    // first, so one layout serves both.
    const onZoom = () => {
      if (ctx.timer) clearTimeout(ctx.timer);
      ctx.timer = setTimeout(() => {
        ctx.timer = null;
        layoutPills(map, ctx);
      }, ZOOM_LAYOUT_DELAY_MS);
    };
    map.on('zoomend', onZoom);
    // The pill font may load after the first draw. Draw again once it has.
    let alive = true;
    void document.fonts?.load(PILL_FONT).then(() => {
      if (!alive) return;
      // Draw now, and drop the redraw that was already waiting for a frame. The canvas exists only
      // once a pill is on the map.
      const pill = renderer as PillRenderer;
      if (!pill._ctx) return;
      if (pill._redrawRequest) L.Util.cancelAnimFrame(pill._redrawRequest);
      pill._redraw();
    });
    return () => {
      alive = false;
      map.off('zoomend', onZoom);
      if (ctx.timer) clearTimeout(ctx.timer);
      ctx.layoutRun += 1;
      if (ctx.slice) clearTimeout(ctx.slice);
      ctxRef.current = null;
      map.removeLayer(group);
    };
  }, [map, renderer, openCard, applyState]);

  // Diff the fetched pins against the pills on the map.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const next = new Map<string, MapPin>();
    for (const pin of pins) next.set(pin.id, pin);

    const gone = new Set<PillLayer>();
    for (const [id, layer] of ctx.layers) {
      const pin = next.get(id);
      const same =
        pin &&
        pin.latitude === layer.pin.latitude &&
        pin.longitude === layer.pin.longitude &&
        pin.price === layer.pin.price &&
        pin.listingType === layer.pin.listingType;
      if (same) continue;
      ctx.group.removeLayer(layer);
      ctx.layers.delete(id);
      gone.add(layer);
      // A removed pill fires no `mouseout`, so a hovered pill would keep its card lit.
      if (ctx.hovered === id) {
        ctx.hovered = null;
        cb.current.onMarkerHover?.(null);
      }
    }
    if (gone.size) ctx.order = ctx.order.filter((layer) => !gone.has(layer));
    const added: PillLayer[] = [];
    for (const pin of next.values()) {
      if (ctx.layers.has(pin.id)) continue;
      const layer = new PillLayer(pin, renderer);
      applyState(layer, ctx);
      ctx.layers.set(pin.id, layer);
      ctx.group.addLayer(layer);
      added.push(layer);
    }
    ctx.order.push(...added);
    if (added.length > BULK_RESTACK) restackAll(ctx);
    else for (const layer of added) restackOne(ctx, layer);
    // The pills are a picture, not elements. Say what it holds, and point to the list, which has
    // every home as a card that a keyboard can reach.
    const canvas = (renderer as PillRenderer)._container;
    canvas?.setAttribute('role', 'img');
    canvas?.setAttribute(
      'aria-label',
      `Map with ${next.size.toLocaleString()} homes. The results list shows the same homes as cards.`,
    );
    if (ctx.timer) {
      clearTimeout(ctx.timer);
      ctx.timer = null;
    }
    layoutPills(map, ctx);
  }, [pins, map, renderer, applyState]);

  // A hover or save change from outside repaints the pills that changed.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    for (const layer of ctx.layers.values()) {
      if (applyState(layer, ctx)) restackOne(ctx, layer);
    }
  }, [activeId, savedIds, applyState]);

  useEffect(
    () => () => {
      map.removeLayer(renderer);
    },
    [map, renderer],
  );

  return null;
}
