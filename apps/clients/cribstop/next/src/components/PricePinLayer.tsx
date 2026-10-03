'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { createRoot, type Root } from 'react-dom/client';
import { Provider } from 'react-redux';
import type { MapPin } from '@cribstop/property-contracts';
import ListingCard from '@/components/ListingCard';
import { store } from '@/lib/store/store';
import type { ListingCardRow } from '@/lib/types';
import { formatListingPrice, formatListingPriceShort } from '@/lib/listing-format';
import {
  layoutPricePills,
  PILL_BODY_H,
  PILL_BOX_H,
  PILL_HIT_TOP,
  pillWidth,
  type PinPoint,
} from '@/lib/map-pins';

/** `micro-label` (12px/700) from DESIGN.md, in the app's own typeface. Markers are raw HTML. */
const MARKER_FONT = "700 12px/1 'Manrope Variable','Inter Variable',system-ui,sans-serif";

/** Dot radius plus the hit tolerance gives a 44px tap target (2 x (4 + 18)). */
const DOT_RADIUS = 4;
/** Slate, lighter than ink, so dense areas show the map. The ring is white. */
const DOT_FILL = '#5B6B8C';
const DOT_HIT_TOLERANCE = 18;
/** How far past the viewport a pill may sit, as a share of the larger side. */
const LAYOUT_PAD_RATIO = 0.15;

/**
 * Popup width in px. A phone map pane is about 350px tall, so the narrower card keeps the popup
 * inside it. Keep equal to the wrapper width classes below.
 */
const popupWidth = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(min-width: 640px)').matches ? 280 : 232;

type PillState = 'plain' | 'saved' | 'active';

/**
 * The pill icon. The box is at least 44px wide and exactly 44px tall, and the tail tip is the
 * bottom centre of the box, which is the icon anchor. The tip sits on the coordinate.
 */
export function buildPillIcon(label: string, fullText: string, state: PillState): L.DivIcon {
  const w = pillWidth(label);
  const tone =
    state === 'plain'
      ? 'background:#fff;color:#222;border-color:rgba(0,0,0,.2);'
      : 'background:#FF385C;color:#fff;border-color:#FF385C;';
  const lift = state === 'active' ? 'transform:scale(1.1);transform-origin:50% 100%;' : '';
  const body = `position:absolute;left:0;right:0;top:${PILL_HIT_TOP}px;height:${PILL_BODY_H}px;display:flex;align-items:center;justify-content:center;box-sizing:border-box;border-radius:9999px;border:1.5px solid;font:${MARKER_FONT};white-space:nowrap;box-shadow:0 3px 10px rgba(34,34,34,0.2);${tone}`;
  const tail = `position:absolute;left:50%;top:${PILL_HIT_TOP + PILL_BODY_H - 5}px;width:10px;height:10px;margin-left:-5px;box-sizing:border-box;transform:rotate(45deg);border:1.5px solid;border-top:none;border-left:none;${tone}`;
  return L.divIcon({
    className: 'cribstop-price-pin',
    html: `<div data-pin-label="${label}" style="position:relative;width:${w}px;height:${PILL_BOX_H}px;cursor:pointer;${lift}"><span style="${body}">${label}</span><span style="${tail}"></span></div>`,
    iconSize: [w, PILL_BOX_H],
    iconAnchor: [w / 2, PILL_BOX_H],
  });
}

interface Entry {
  pin: MapPin;
  label: string;
  fullText: string;
  latlng: L.LatLng;
  dot: L.CircleMarker;
  marker: L.Marker | null;
  pillState: PillState;
}

/**
 * Every home as a price pill at its exact coordinate (#546). There are no clusters. Where pills
 * would overlap on screen, the higher-priority pill stays whole and the rest draw as dots at their
 * exact spots. Priority is the hovered card, then saved homes, then the server order (newest).
 *
 * Dots are canvas circles with an enlarged hit area, so 2,000 homes stay cheap to draw and a dot is
 * still a 44px tap target. Hovering a dot shows its pill. Pills are DOM markers, and the layout
 * keeps them clear of each other, so only a screenful exists at once.
 */
export default function PricePinLayer({
  pins,
  rowsById,
  activeId,
  savedIds,
  onMarkerHover,
  onOpenListing,
}: {
  pins: readonly MapPin[];
  /** The current results page. A pin for one of these rows opens the card popup. */
  rowsById: ReadonlyMap<string, ListingCardRow>;
  activeId: string | null;
  savedIds?: ReadonlySet<string>;
  onMarkerHover?: (id: string | null) => void;
  /** A pin for a row off the current page opens the listing panel, which loads the row. */
  onOpenListing: (id: string) => void;
}) {
  const map = useMap();
  const renderer = useMemo(() => L.canvas({ padding: 0.5, tolerance: DOT_HIT_TOLERANCE }), []);
  const cb = useRef({ onMarkerHover, onOpenListing, rowsById });
  cb.current = { onMarkerHover, onOpenListing, rowsById };
  const view = useRef({ activeId, savedIds });
  view.current = { activeId, savedIds };
  const relayoutRef = useRef<() => void>(() => undefined);
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
   * rebuilds every marker, and opening a popup can itself pan the map. The popup must survive that.
   */
  const openCard = useCallback(
    (id: string, latlng: L.LatLng, tipOffset: number) => {
      const row = cb.current.rowsById.get(id);
      // A pin off the current page has no row to render, so the panel loads it.
      if (!row) {
        cb.current.onOpenListing(id);
        return;
      }
      closeCard();
      const el = document.createElement('div');
      const root = createRoot(el);
      // The popup is its own React root, so it gets the store that `AppProvider` gives the page.
      root.render(
        <Provider store={store}>
          <div className="w-[232px] bg-surface p-2 sm:w-[280px]">
            <ListingCard listing={row} />
          </div>
        </Provider>,
      );
      const popup = L.popup({
        closeButton: false,
        maxWidth: popupWidth(),
        minWidth: popupWidth(),
        autoPan: true,
        offset: L.point(0, -tipOffset),
        // Keep the popup clear of the zoom controls (right) and the notice banner (top).
        autoPanPaddingTopLeft: L.point(16, 64),
        autoPanPaddingBottomRight: L.point(72, 16),
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

  useEffect(() => {
    const entries: Entry[] = pins.map((pin) => ({
      pin,
      label: formatListingPriceShort(pin.price, pin.listingType).text,
      fullText: formatListingPrice(pin.price, pin.listingType).text,
      latlng: L.latLng(pin.latitude, pin.longitude),
      dot: L.circleMarker([pin.latitude, pin.longitude], {
        renderer,
        radius: DOT_RADIUS,
        weight: 1.5,
        color: '#fff',
        fillColor: DOT_FILL,
        fillOpacity: 0.92,
        bubblingMouseEvents: false,
      }),
      marker: null,
      pillState: 'plain',
    }));
    const byId = new Map(entries.map((e) => [e.pin.id, e]));
    const dotLayer = L.layerGroup().addTo(map);
    const pillLayer = L.layerGroup().addTo(map);
    let hoveredDot: string | null = null;
    let hoveredPill: string | null = null;
    let tempPill: L.Marker | null = null;

    const stateOf = (id: string): PillState =>
      view.current.activeId === id ? 'active' : view.current.savedIds?.has(id) ? 'saved' : 'plain';

    const hideTemp = () => {
      if (tempPill) map.removeLayer(tempPill);
      tempPill = null;
    };

    const addPill = (entry: Entry) => {
      const marker = L.marker(entry.latlng, {
        icon: buildPillIcon(entry.label, entry.fullText, entry.pillState),
        title: entry.fullText,
        alt: entry.fullText,
        keyboard: true,
      });
      marker.on('mouseover', () => {
        hoveredPill = entry.pin.id;
        cb.current.onMarkerHover?.(entry.pin.id);
      });
      marker.on('mouseout', () => {
        hoveredPill = null;
        cb.current.onMarkerHover?.(null);
      });
      marker.on('click', () => openCard(entry.pin.id, entry.latlng, PILL_BOX_H + 4));
      entry.marker = marker;
      pillLayer.addLayer(marker);
    };

    for (const entry of entries) {
      entry.dot.on('mouseover', () => {
        hoveredDot = entry.pin.id;
        hideTemp();
        tempPill = L.marker(entry.latlng, {
          icon: buildPillIcon(entry.label, entry.fullText, 'active'),
          interactive: false,
          keyboard: false,
          zIndexOffset: 1000,
        }).addTo(map);
        cb.current.onMarkerHover?.(entry.pin.id);
      });
      entry.dot.on('mouseout', () => {
        hoveredDot = null;
        hideTemp();
        cb.current.onMarkerHover?.(null);
      });
      entry.dot.on('click', () => {
        // A touch tap fires `mouseover` and no `mouseout`, so end the hover here.
        hoveredDot = null;
        hideTemp();
        cb.current.onMarkerHover?.(null);
        openCard(entry.pin.id, entry.latlng, DOT_RADIUS + 6);
      });
    }

    const relayout = () => {
      const { activeId: active, savedIds: saved } = view.current;
      // The hovered card's pill wins its spot. A dot under the pointer must not swap to a pill, or
      // the dot would vanish while it is hovered.
      const first = active && active !== hoveredDot ? byId.get(active) : undefined;
      const ordered: Entry[] = [];
      if (first) ordered.push(first);
      for (const e of entries) if (e !== first && saved?.has(e.pin.id)) ordered.push(e);
      for (const e of entries) if (e !== first && !saved?.has(e.pin.id)) ordered.push(e);

      const size = map.getSize();
      const points: PinPoint[] = ordered.map((e) => {
        const p = map.latLngToContainerPoint(e.latlng);
        return { id: e.pin.id, x: p.x, y: p.y, label: e.label };
      });
      const pills = layoutPricePills(points, {
        width: size.x,
        height: size.y,
        pad: Math.max(size.x, size.y) * LAYOUT_PAD_RATIO,
      });

      for (const entry of entries) {
        const wantPill = pills.has(entry.pin.id);
        if (wantPill && !entry.marker) {
          dotLayer.removeLayer(entry.dot);
          entry.pillState = stateOf(entry.pin.id);
          addPill(entry);
        } else if (!wantPill) {
          if (entry.marker) {
            pillLayer.removeLayer(entry.marker);
            entry.marker = null;
            // A removed marker fires no `mouseout`, so a hovered pill would keep its card lit.
            if (hoveredPill === entry.pin.id) {
              hoveredPill = null;
              cb.current.onMarkerHover?.(null);
            }
          }
          if (!dotLayer.hasLayer(entry.dot)) dotLayer.addLayer(entry.dot);
          entry.dot.setStyle({ fillColor: saved?.has(entry.pin.id) ? '#FF385C' : DOT_FILL });
        } else if (entry.marker) {
          const next = stateOf(entry.pin.id);
          if (next !== entry.pillState) {
            entry.pillState = next;
            entry.marker.setIcon(buildPillIcon(entry.label, entry.fullText, next));
            entry.marker.setZIndexOffset(next === 'active' ? 1000 : 0);
          }
        }
      }
    };
    relayoutRef.current = relayout;
    relayout();
    map.on('zoomend moveend resize', relayout);

    return () => {
      map.off('zoomend moveend resize', relayout);
      relayoutRef.current = () => undefined;
      hideTemp();
      map.removeLayer(pillLayer);
      map.removeLayer(dotLayer);
    };
  }, [pins, map, renderer, openCard]);

  // A hover or save change re-picks the pills and restyles the two pills that changed.
  useEffect(() => {
    relayoutRef.current();
  }, [activeId, savedIds]);

  useEffect(
    () => () => {
      map.removeLayer(renderer);
    },
    [map, renderer],
  );

  return null;
}
