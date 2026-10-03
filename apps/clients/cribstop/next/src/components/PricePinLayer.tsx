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
import { coordKeyOf, FAN_MIN_ZOOM, fanOffsets } from '@/lib/map-pins';
import {
  drawHome,
  PILL_ANCHOR_H,
  PILL_FONT,
  pinBounds,
  pinContains,
  pinGeometry,
  type PinState,
} from '@/lib/pin-draw';

export { FAN_MIN_ZOOM };

/**
 * Popup width in px. A phone map pane is about 350px tall, so the narrower card keeps the popup
 * inside it. Keep equal to the wrapper width classes below.
 */
const popupWidth = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(min-width: 640px)').matches ? 280 : 232;

/** A phone or tablet has no hover. A tap opens the popup and the pin shows no hover pill. */
const canHover = () =>
  typeof window === 'undefined' || !window.matchMedia?.('(hover: none)').matches;

/** The parts of Leaflet's canvas renderer that this layer drives. */
interface PinRenderer extends L.Canvas {
  _drawing: boolean;
  _ctx: CanvasRenderingContext2D;
  _extendRedrawBounds: (layer: L.Layer) => void;
  _requestRedraw: (layer: L.Layer) => void;
  _redraw: () => void;
  _redrawRequest: number | null;
  _container?: HTMLCanvasElement;
}

type Offset = { dx: number; dy: number };
const NO_OFFSET: Offset = { dx: 0, dy: 0 };

/**
 * One home on the shared canvas (#549, #557). The renderer draws it and finds the home under the
 * pointer, and a layer later in its draw order is on top. A home is a picture, so 1,800 of them
 * cost one canvas and a pan moves that canvas as one piece.
 */
class PinLayer extends L.CircleMarker {
  readonly pin: MapPin;
  state: PinState = 'plain';
  offset: Offset = NO_OFFSET;

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
  }

  /** The price on the pill. A home at rest draws no price, so it never formats one. */
  get label() {
    return this.state === 'active'
      ? formatListingPriceShort(this.pin.price, this.pin.listingType).text
      : '';
  }

  /** `_point` is in layer pixels, the canvas's own space. */
  geometry() {
    const { x, y } = (this as unknown as { _point: L.Point })._point;
    return pinGeometry(x, y, this.offset);
  }

  // Leaflet calls these three. They replace the circle's own bounds, hit test and drawing.
  _updateBounds() {
    const [minX, minY, maxX, maxY] = pinBounds(
      this.geometry(),
      this.label,
      this.state === 'active',
    );
    (this as unknown as { _pxBounds: L.Bounds })._pxBounds = L.bounds(
      L.point(minX, minY),
      L.point(maxX, maxY),
    );
  }

  _containsPoint(point: L.Point) {
    return pinContains(this.geometry(), this.label, this.state === 'active', point.x, point.y);
  }

  _updatePath() {
    const renderer = (this as unknown as { _renderer: PinRenderer })._renderer;
    if (!renderer._drawing) return;
    drawHome(renderer._ctx, this.geometry(), this.label, this.state);
  }
}

/** The renderer that draws a home. It is set once the home is on the map. */
const rendererOf = (layer: PinLayer) => (layer as unknown as { _renderer?: PinRenderer })._renderer;

/** Repaints a home. The old bounds are cleared and the new ones drawn, as Leaflet's own update does. */
function repaint(layer: PinLayer) {
  const renderer = rendererOf(layer);
  if (!renderer) return;
  renderer._extendRedrawBounds(layer);
  layer._updateBounds();
  renderer._requestRedraw(layer);
}

/**
 * Draw order, first drawn first. A hovered or selected home is last, so on top. The rest go by
 * screen y, so a lower pin covers a higher one, as the eye expects. The hit test reads this same
 * order from the end, so the pin drawn on top takes the click. The order depends only on state and
 * position, so a pan does not reshuffle it.
 */
const STATE_ORDER: Record<PinState, number> = { plain: 0, saved: 0, active: 1 };
const pointY = (l: PinLayer) => (l as unknown as { _point?: L.Point })._point?.y ?? 0;
const byDrawOrder = (a: PinLayer, b: PinLayer) =>
  STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
  pointY(a) - pointY(b) ||
  (a.pin.id < b.pin.id ? 1 : a.pin.id > b.pin.id ? -1 : 0);

interface DrawNode {
  layer: PinLayer;
  prev: DrawNode | null;
  next: DrawNode | null;
}
type OrderedRenderer = PinRenderer & { _drawFirst: DrawNode | null; _drawLast: DrawNode | null };

/**
 * Moves one home after `anchor` in the renderer's draw list, or to the front. Leaflet has only
 * "to front" and "to back", and a hover must put a home back where it was, not at the end.
 */
function moveAfter(layer: PinLayer, anchor: PinLayer | null) {
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

/** Puts one home at its place in the draw order. The sorted list stays sorted. */
function restackOne(ctx: Ctx, layer: PinLayer) {
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

/** Puts every home in order. It is for a big change, such as the first fetch. */
function restackAll(ctx: Ctx) {
  ctx.order.sort(byDrawOrder);
  for (const layer of ctx.order) layer.bringToFront();
}

/** More new homes than this are put in order in one pass, not one by one. */
const BULK_RESTACK = 40;

interface Ctx {
  group: L.FeatureGroup;
  layers: Map<string, PinLayer>;
  /** The homes in draw order, first drawn first. */
  order: PinLayer[];
  /** The home under the pointer. */
  hovered: string | null;
  /** The home whose popup is open. */
  selected: string | null;
}

/**
 * Fans out homes that share one true coordinate, from `FAN_MIN_ZOOM` up, so each condo unit is
 * reachable. Every other home stays on its coordinate and small pins overlap freely. A fanned pin
 * draws a leader line to its true coordinate. A layout is cheap, so it runs in one go.
 */
function layoutPins(map: L.Map, ctx: Ctx) {
  const fan =
    map.getZoom() >= FAN_MIN_ZOOM
      ? fanOffsets(
          [...ctx.layers.values()].map((layer) => ({
            id: layer.pin.id,
            coordKey: coordKeyOf(layer.pin.latitude, layer.pin.longitude),
          })),
        )
      : null;
  for (const layer of ctx.layers.values()) {
    const next = fan?.get(layer.pin.id) ?? NO_OFFSET;
    if (next.dx === layer.offset.dx && next.dy === layer.offset.dy) continue;
    const renderer = rendererOf(layer);
    renderer?._extendRedrawBounds(layer);
    layer.offset = next;
    layer._updateBounds();
    renderer?._extendRedrawBounds(layer);
  }
  const any = ctx.order[0];
  if (any) rendererOf(any)?._requestRedraw(any);
}

/**
 * Every home as a small pin at its exact coordinate (#546, #549, #557). There are no clusters. A
 * hovered or selected home shows its price on a red pill, drawn on top.
 *
 * The homes are drawn on one canvas. A fetch is diffed against the homes on the map, so a pan adds
 * and removes only the homes that changed, and a hover or save change repaints one or two.
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

  /** Sets one home's look and stack order. Only repaints when the state changed. */
  const applyState = useCallback((layer: PinLayer, ctx: Ctx) => {
    const { activeId: active, savedIds: saved } = view.current;
    const id = layer.pin.id;
    const next: PinState =
      ctx.hovered === id || ctx.selected === id || active === id
        ? 'active'
        : saved?.has(id)
          ? 'saved'
          : 'plain';
    if (next === layer.state) return false;
    layer.state = next;
    repaint(layer);
    return true;
  }, []);

  const refresh = useCallback(
    (id: string | null) => {
      const ctx = ctxRef.current;
      const layer = id ? ctx?.layers.get(id) : undefined;
      if (ctx && layer && applyState(layer, ctx)) restackOne(ctx, layer);
    },
    [applyState],
  );

  useEffect(() => {
    const onPopupClose = (event: L.PopupEvent) => {
      const open = popupRef.current;
      if (!open || open.popup !== event.popup) return;
      popupRef.current = null;
      setTimeout(() => open.root.unmount(), 0);
      const ctx = ctxRef.current;
      const was = ctx?.selected ?? null;
      if (ctx) ctx.selected = null;
      refresh(was);
    };
    map.on('popupclose', onPopupClose);
    return () => {
      map.off('popupclose', onPopupClose);
      closeCard();
    };
  }, [map, closeCard, refresh]);

  // One feature group for the layer. Event delegation keeps it to three handlers, not 5,400.
  useEffect(() => {
    const group = L.featureGroup().addTo(map);
    const ctx: Ctx = { group, layers: new Map(), order: [], hovered: null, selected: null };
    ctxRef.current = ctx;
    const find = (event: L.LeafletEvent) =>
      ctx.layers.get((event.propagatedFrom as PinLayer).pin.id);
    group.on('mouseover', (event) => {
      const layer = find(event);
      if (!layer || !canHover()) return;
      ctx.hovered = layer.pin.id;
      if (applyState(layer, ctx)) restackOne(ctx, layer);
      cb.current.onMarkerHover?.(layer.pin.id);
    });
    group.on('mouseout', (event) => {
      const layer = find(event);
      if (!layer || !canHover()) return;
      ctx.hovered = null;
      if (applyState(layer, ctx)) restackOne(ctx, layer);
      cb.current.onMarkerHover?.(null);
    });
    group.on('click', (event) => {
      const layer = find(event);
      if (!layer) return;
      const previous = ctx.selected;
      // `openCard` closes the old popup, and its `popupclose` clears the selection. Select after.
      openCard(
        layer.pin.id,
        layer.getLatLng(),
        L.point(layer.offset.dx, layer.offset.dy - PILL_ANCHOR_H),
      );
      ctx.selected = layer.pin.id;
      refresh(previous);
      refresh(layer.pin.id);
    });
    // The fan depends on the zoom. A pan only moves the canvas, so it needs no new layout.
    const onZoom = () => layoutPins(map, ctx);
    map.on('zoomend', onZoom);
    // The pill font may load after the first draw. Draw again once it has.
    let alive = true;
    void document.fonts?.load(PILL_FONT).then(() => {
      if (!alive) return;
      // Draw now, and drop the redraw that was already waiting for a frame. The canvas exists only
      // once a home is on the map.
      const canvas = renderer as PinRenderer;
      if (!canvas._ctx) return;
      if (canvas._redrawRequest) L.Util.cancelAnimFrame(canvas._redrawRequest);
      canvas._redraw();
    });
    return () => {
      alive = false;
      map.off('zoomend', onZoom);
      ctxRef.current = null;
      map.removeLayer(group);
    };
  }, [map, renderer, openCard, applyState, refresh]);

  // Diff the fetched pins against the homes on the map.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const next = new Map<string, MapPin>();
    for (const pin of pins) next.set(pin.id, pin);

    const gone = new Set<PinLayer>();
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
      // A removed home fires no `mouseout`, so a hovered home would keep its card lit.
      if (ctx.hovered === id) {
        ctx.hovered = null;
        cb.current.onMarkerHover?.(null);
      }
    }
    if (gone.size) ctx.order = ctx.order.filter((layer) => !gone.has(layer));
    const added: PinLayer[] = [];
    for (const pin of next.values()) {
      if (ctx.layers.has(pin.id)) continue;
      const layer = new PinLayer(pin, renderer);
      applyState(layer, ctx);
      ctx.layers.set(pin.id, layer);
      ctx.group.addLayer(layer);
      added.push(layer);
    }
    ctx.order.push(...added);
    if (added.length > BULK_RESTACK) restackAll(ctx);
    else for (const layer of added) restackOne(ctx, layer);
    // The pins are a picture, not elements. Say what it holds, and point to the list, which has
    // every home as a card that a keyboard can reach.
    const canvas = (renderer as PinRenderer)._container;
    canvas?.setAttribute('role', 'img');
    canvas?.setAttribute(
      'aria-label',
      `Map with ${next.size.toLocaleString()} homes. The results list shows the same homes as cards.`,
    );
    layoutPins(map, ctx);
  }, [pins, map, renderer, applyState]);

  // A hover or save change from outside repaints the homes that changed.
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
