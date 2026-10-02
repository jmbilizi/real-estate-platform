'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CustomMapControls } from '@/components/CustomMapControls';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { createRoot, type Root } from 'react-dom/client';
import { Provider } from 'react-redux';
import type {
  MapCluster,
  MapPin,
  MapResponse,
  NeighborhoodRow,
} from '@cribstop/property-contracts';
import NeighborhoodMapLayer, {
  selectMappableNeighborhoods,
} from '@/components/NeighborhoodMapLayer';
import type { ListingCardRow } from '@/lib/types';
import { getListingsMap, type ListingSearchQuery } from '@/lib/api/listings';
import { openListingPanel } from '@/lib/listing-panel';
import { hasMapCoordinates } from '@/lib/listing-format';
import ListingCard from '@/components/ListingCard';
import { store } from '@/lib/store/store';
import { useTileFailure, useTileLayerConfig } from '@/components/map-tiles';

// Set by ListingsMapInner. A pin for a row off the current page calls it, because a pin handler
// outlives the render that created it.
let _openListing: ((id: string) => void) | null = null;

/** Popup width in px. Keep equal to `w-[280px]` on the popup wrapper below. */
const POPUP_WIDTH = 280;
const PILL_W = 70;
const PILL_H = 30;

/**
 * Which rows may produce a map pin.
 *
 * A row whose seller opted out of address display has `address`, `latitude` and `longitude` null
 * together — there is deliberately no city/ZIP centroid fallback anywhere in this file, because a
 * centroid is fabricated precision that partially re-identifies the address the seller withheld.
 * The excluded row is NOT dropped from anything else: it stays in `listings` (the result count, the
 * list view) and only disappears from the pin set built here.
 *
 * Exported and pure (no mutation, no reordering) so pin selection can be unit-tested without
 * mounting Leaflet, which does not run under jsdom.
 */
export function selectMappableListings(listings: ListingCardRow[]): ListingCardRow[] {
  return listings.filter(hasMapCoordinates);
}

/**
 * Sample-data banner copy for the pins currently on the map.
 *
 * The claim must scope to what is actually sample. All rows sample and a mixed set need different
 * copy — "the map" versus "some listings" — or the disclosure becomes false once real Bright MLS
 * rows share a result set with sample rows (#120). Returns `null` when no pin is a sample, which
 * keeps the "never render with no sample pin visible" gate at the render site unchanged.
 */
export function getSampleBannerCopy(pins: ListingCardRow[]): string | null {
  return sampleBannerCopyFor(pins.filter((listing) => listing.isSample).length, pins.length);
}

/** The same copy from counts, for server pins and clusters that carry no per-row flag. */
export function sampleBannerCopyFor(sampleCount: number, count: number): string | null {
  if (sampleCount === 0) return null;
  if (sampleCount === count) {
    return 'Sample data — prices shown on this map are illustrative.';
  }
  return 'Some listings on this map are sample data — their prices are illustrative.';
}

/** Coordinate pairs for the rows that have them — used for map bounds, never for pin placement itself. */
function toLatLngPairs(listings: ListingCardRow[]): [number, number][] {
  const pairs: [number, number][] = [];
  for (const listing of listings) {
    if (hasMapCoordinates(listing)) pairs.push([listing.latitude, listing.longitude]);
  }
  return pairs;
}

/**
 * Compact label for the price pill on the marker itself. A null price (seller-directed withholding)
 * must never render as `$0` or an empty pill — "Withheld" is the honest, compact alternative; the
 * popup card renders the full withheld sentence.
 */
function pinPriceLabel({ price, listingType }: Pick<MapPin, 'price' | 'listingType'>): string {
  if (price === null) return 'Withheld';
  if (listingType === 'rent') return `$${(price / 1000).toFixed(1)}k`;
  if (price >= 1_000_000) return `$${(price / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(price / 1000)}k`;
}

/**
 * `micro-label` (12px/700) from DESIGN.md, in the app's own typeface.
 *
 * These markers are built as raw HTML strings, so they get no Tailwind and no inherited font —
 * every one of them hardcoded `Inter`, which is the *fallback* in the font stack, not the face the
 * app ships. Every price pin and cluster on every map was therefore rendering in a different
 * typeface from the rest of the product, and the cluster badge was 800 weight, which the type scale
 * does not define at any size.
 */
const MARKER_FONT = "700 12px/1 'Manrope Variable','Inter Variable',system-ui,sans-serif";

function buildPriceIcon(price: string, active: boolean, saved: boolean) {
  // Red: #FF385C, Black: #222, White: #fff
  let tone;
  if (active) {
    tone = 'background:#FF385C;color:#fff;border-color:#FF385C;transform:scale(1.1);z-index:1000;';
  } else if (saved) {
    tone = 'background:#FF385C;color:#fff;border-color:#FF385C;';
  } else {
    tone = 'background:#fff;color:#222;border-color:rgba(0,0,0,.15);';
  }
  return L.divIcon({
    className: 'cribstop-price-marker',
    html: `<span style="${tone}display:inline-flex;align-items:center;justify-content:center;min-width:${PILL_W}px;height:${PILL_H}px;padding:0 10px;border-radius:9999px;border:1.5px solid;font:${MARKER_FONT};box-shadow:0 4px 16px rgba(34,34,34,0.18),0 1.5px 8px rgba(0,0,0,0.08);white-space:nowrap;cursor:pointer;transition:transform .15s;">${price}</span>`,
    iconSize: [PILL_W, PILL_H],
    iconAnchor: [PILL_W / 2, PILL_H / 2],
    popupAnchor: [0, -PILL_H / 2 - 2],
  });
}

function clusterIconFactory(cluster: any, highlightId: string | null) {
  const count = cluster.getChildCount();
  // Only highlight cluster if it contains the hovered property (activeId)
  let highlight = false;
  if (highlightId) {
    cluster.getAllChildMarkers().forEach((marker: any) => {
      if (marker.options && marker.options.listingId === highlightId) highlight = true;
    });
  }
  const border = highlight ? '4px solid #FF385C' : '2.5px solid #bbb';
  const boxShadow = highlight
    ? '0 0 0 6px rgba(255,56,92,0.18),0 8px 24px rgba(34,34,34,0.18),0 1.5px 8px rgba(0,0,0,0.08)'
    : '0 8px 24px rgba(34,34,34,0.13),0 1.5px 8px rgba(0,0,0,0.06)';
  const bg = highlight ? '#fff' : '#fff';
  const color = highlight ? '#FF385C' : '#222';
  return L.divIcon({
    className: 'cribstop-cluster',
    html: `<span style="background:${bg};color:${color};display:inline-flex;align-items:center;justify-content:center;width:42px;height:42px;border-radius:9999px;border:${border};font:${MARKER_FONT};box-shadow:${boxShadow};">${count}</span>`,
    iconSize: [42, 42],
    iconAnchor: [21, 21],
  });
}

/** A page row with coordinates as a pin. Never a city or ZIP centroid. */
function toPin(listing: ListingCardRow & { latitude: number; longitude: number }): MapPin {
  return {
    id: listing.id,
    latitude: listing.latitude,
    longitude: listing.longitude,
    price: listing.price,
    status: listing.status,
    listingType: listing.listingType,
  };
}

function formatClusterCount(count: number): string {
  if (count >= 10_000) return `${Math.round(count / 1000)}k`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}

function buildServerClusterIcon(count: number) {
  const size = count >= 1000 ? 56 : count >= 100 ? 48 : 42;
  return L.divIcon({
    className: 'cribstop-cluster',
    html: `<span style="background:#fff;color:#222;display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:9999px;border:2.5px solid #bbb;font:${MARKER_FONT};box-shadow:0 8px 24px rgba(34,34,34,0.13),0 1.5px 8px rgba(0,0,0,0.06);cursor:pointer;">${formatClusterCount(count)}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/**
 * Server clusters (#377). A click zooms to the cluster's own extent, so the next viewport
 * request breaks it into smaller clusters or pins.
 */
function ServerClusters({ clusters }: { clusters: MapCluster[] }) {
  const map = useMap();
  useEffect(() => {
    const layer = L.layerGroup();
    for (const cluster of clusters) {
      const marker = L.marker([cluster.latitude, cluster.longitude], {
        icon: buildServerClusterIcon(cluster.count),
      });
      marker.on('click', () => {
        const { west, south, east, north } = cluster.bounds;
        const bounds = L.latLngBounds([south, west], [north, east]);
        if (west === east && south === north) {
          map.setView([south, west], Math.min(map.getZoom() + 3, map.getMaxZoom()));
        } else {
          map.fitBounds(bounds, { padding: [40, 40], maxZoom: map.getMaxZoom() });
        }
      });
      layer.addLayer(marker);
    }
    layer.addTo(map);
    return () => {
      map.removeLayer(layer);
    };
  }, [clusters, map]);
  return null;
}

/**
 * Requests pins or clusters for the viewport on load, on every pan or zoom (debounced), and on
 * every filter change. It never touches the list: the list keeps its own search and `total`.
 */
function ViewportQuery({
  filters,
  onResult,
}: {
  filters: ListingSearchQuery;
  onResult: (result: MapResponse | null) => void;
}) {
  const map = useMap();
  const filterKey = JSON.stringify(filters);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => {
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const run = () => {
      controller?.abort();
      controller = new AbortController();
      const b = map.getBounds();
      getListingsMap(
        filtersRef.current,
        { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() },
        map.getZoom(),
        controller.signal,
      )
        .then((result) => onResultRef.current(result))
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          // The page's own pins stay on the map when the viewport request fails.
          onResultRef.current(null);
        });
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, 300);
    };

    schedule();
    map.on('moveend', schedule);
    return () => {
      map.off('moveend', schedule);
      if (timer) clearTimeout(timer);
      controller?.abort();
    };
  }, [map, filterKey]);

  return null;
}

function ClusteredMarkers({
  pins,
  rowsById,
  activeId,
  savedIds,
  onMarkerHover,
}: {
  pins: MapPin[];
  /** The current results page. A pin for one of these rows gets the full popup. */
  rowsById: Map<string, ListingCardRow>;
  activeId: string | null;
  savedIds?: Set<string>;
  onMarkerHover?: (id: string | null) => void;
}) {
  const map = useMap();
  const clusterGroupRef = useRef<L.MarkerClusterGroup | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const popupRootsRef = useRef<Map<string, Root>>(new Map());

  // Build / rebuild markers ONLY when the listings array itself changes.
  // Hover state is applied separately below to avoid rebuilding the whole cluster on every hover.
  useEffect(() => {
    if (clusterGroupRef.current) {
      const oldRoots = popupRootsRef.current;
      popupRootsRef.current = new Map();
      setTimeout(() => {
        oldRoots.forEach((root) => {
          try {
            root.unmount();
          } catch {
            /* ignore */
          }
        });
      }, 0);
      map.removeLayer(clusterGroupRef.current);
      clusterGroupRef.current = null;
      markersRef.current.clear();
    }

    const group = L.markerClusterGroup({
      iconCreateFunction: (cluster) => clusterIconFactory(cluster, activeId),
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      maxClusterRadius: 55,
      chunkedLoading: true,
      removeOutsideVisibleBounds: false,
    });

    pins.forEach((l) => {
      const marker = L.marker([l.latitude, l.longitude], {
        icon: buildPriceIcon(pinPriceLabel(l), activeId === l.id, !!savedIds?.has(l.id)),
        // @ts-expect-error: custom property for cluster highlight
        listingId: l.id, // for cluster highlight
      });

      // A pin for a row on the current page gets the popup card. Any other pin opens the listing
      // panel, which loads the row and carries the attribution a popup would.
      const row = rowsById.get(l.id);
      if (row) {
        const popupEl = document.createElement('div');
        const root = createRoot(popupEl);
        // The popup is its own React root, so it gets the store that `AppProvider` gives the page.
        root.render(
          <Provider store={store}>
            <div className="w-[280px] bg-surface p-2">
              <ListingCard listing={row} />
            </div>
          </Provider>,
        );
        popupRootsRef.current.set(l.id, root);
        marker.bindPopup(popupEl, {
          closeButton: false,
          maxWidth: POPUP_WIDTH,
          minWidth: POPUP_WIDTH,
          autoPan: true,
        });
      } else {
        marker.on('click', () => _openListing?.(l.id));
      }

      marker.on('mouseover', () => onMarkerHover?.(l.id));
      marker.on('mouseout', () => onMarkerHover?.(null));

      markersRef.current.set(l.id, marker);
      group.addLayer(marker);
    });

    clusterGroupRef.current = group;
    map.addLayer(group);

    return () => {
      const oldRoots = popupRootsRef.current;
      popupRootsRef.current = new Map();
      setTimeout(() => {
        oldRoots.forEach((root) => {
          try {
            root.unmount();
          } catch {
            /* ignore */
          }
        });
      }, 0);
      if (clusterGroupRef.current) {
        map.removeLayer(clusterGroupRef.current);
        clusterGroupRef.current = null;
      }
      markersRef.current.clear();
    };
  }, [pins, rowsById]);

  // Lightweight effect: just update each marker's icon when activeId / savedIds change.
  // No cluster rebuild, no map pan, no flicker.
  useEffect(() => {
    pins.forEach((l) => {
      const marker = markersRef.current.get(l.id);
      if (!marker) return;
      marker.setIcon(buildPriceIcon(pinPriceLabel(l), activeId === l.id, !!savedIds?.has(l.id)));
      if (activeId === l.id) {
        marker.setZIndexOffset(1000);
      } else {
        marker.setZIndexOffset(0);
      }
    });
    // Force cluster icons to update by re-clustering (workaround for cluster highlight)
    if (clusterGroupRef.current) {
      clusterGroupRef.current.refreshClusters();
    }
  }, [activeId, savedIds, pins]);

  return null;
}

function InvalidateOnMount() {
  const map = useMap();
  useEffect(() => {
    // ResizeObserver fires the moment the container has real dimensions —
    // handles all navigation timing without relying on fixed timeouts.
    map.invalidateSize();
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  return null;
}

/**
 * Activates scroll-wheel zoom only after the user clicks the map (Airbnb/Google Maps pattern).
 * Prevents the map from hijacking page scroll when the cursor passes over it mid-scroll.
 * Deactivates when the user clicks outside the map.
 */
function ClickToActivateScroll({ onChange }: { onChange?: (active: boolean) => void }) {
  const map = useMap();
  useEffect(() => {
    map.scrollWheelZoom.disable();
    onChange?.(false);

    const container = map.getContainer();
    const activate = () => {
      map.scrollWheelZoom.enable();
      onChange?.(true);
    };
    const deactivate = (e: MouseEvent) => {
      if (!container.contains(e.target as Node)) {
        map.scrollWheelZoom.disable();
        onChange?.(false);
      }
    };

    container.addEventListener('click', activate);
    document.addEventListener('click', deactivate);

    return () => {
      container.removeEventListener('click', activate);
      document.removeEventListener('click', deactivate);
    };
  }, [map, onChange]);
  return null;
}

// Helper to pan/zoom to a given lat/lng
// Single view controller: polygon bounds > listing bounds > center.
// Fires whenever the search polygon, listings, or center changes.
function FitView({
  geojson,
  coords,
  center,
  bounds: focus,
}: {
  /** A drilled-down neighborhood's bounds (#503). Wins over everything below. */
  bounds?: NeighborhoodBounds | null;
  geojson: object | null;
  /** Pin coordinates only — rows without them never contribute a fabricated centroid to the fit. */
  coords: [number, number][];
  center: [number, number] | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (focus) {
      const bounds = L.latLngBounds([focus.south, focus.west], [focus.north, focus.east]);
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [32, 32], maxZoom: 16, animate: true });
        return;
      }
    }
    if (geojson) {
      // Fit exactly to the searched boundary with a small pad so the stroke isn't clipped
      const layer = L.geoJSON(geojson as Parameters<typeof L.geoJSON>[0]);
      const bounds = layer.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [32, 32], maxZoom: 15, animate: true });
        return;
      }
    }
    if (coords.length) {
      // Fall back to fitting the pinned marker positions
      const bounds = L.latLngBounds(coords);
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [60, 60], maxZoom: 14, animate: true });
        return;
      }
    }
    if (center) {
      // Last resort: just pan to the geocoded point
      map.setView(center, 13, { animate: true });
    }
  }, [geojson, coords, center, focus]);
  return null;
}

function BoundaryLayer({ geojson }: { geojson: object | null }) {
  const map = useMap();
  const layerRef = useRef<L.GeoJSON | null>(null);
  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }
    if (!geojson) return;
    const layer = L.geoJSON(geojson as Parameters<typeof L.geoJSON>[0], {
      style: {
        color: '#FF385C',
        weight: 2,
        opacity: 0.75,
        fillOpacity: 0.04,
        fillColor: '#FF385C',
        dashArray: '6 5',
        lineCap: 'round',
        lineJoin: 'round',
      },
    });
    layer.addTo(map);
    layerRef.current = layer;
    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [geojson, map]);
  return null;
}

interface Props {
  listings: ListingCardRow[];
  activeId?: string | null;
  savedIds?: Set<string>;
  onMarkerHover?: (id: string | null) => void;
  searchCenter?: [number, number] | null;
  searchPolygon?: object | null;
  /** The list's filters. The map requests every match in the viewport with them (#377). */
  filters?: ListingSearchQuery;
  /** The list's `total`, the one count for the search. */
  total?: number;
  /** Grouped view (#503): one marker per neighborhood replaces the listing pins and clusters. */
  neighborhoods?: NeighborhoodMarkers;
  /** Fit the map here (a drilled-down neighborhood). */
  focusBounds?: NeighborhoodBounds | null;
}

export type NeighborhoodBounds = NonNullable<NeighborhoodRow['bounds']>;

export interface NeighborhoodMarkers {
  rows: readonly NeighborhoodRow[];
  activeKey: string | null;
  onActive: (key: string | null) => void;
  onSelect: (row: NeighborhoodRow) => void;
  onTapPreview?: (key: string) => void;
}

export default function ListingsMapInner({
  listings,
  activeId,
  savedIds,
  onMarkerHover,
  searchCenter,
  searchPolygon,
  filters,
  total,
  neighborhoods,
  focusBounds,
}: Props) {
  const grouped = neighborhoods !== undefined;
  const groupMarkers = useMemo(
    () => selectMappableNeighborhoods(neighborhoods?.rows ?? []),
    [neighborhoods?.rows],
  );
  const groupCoords = useMemo<[number, number][]>(
    () => groupMarkers.map((r) => [r.centroid.lat, r.centroid.lng]),
    [groupMarkers],
  );
  // Keep the module-level callback up to date so a pin for a row
  // off the current page can open the listing panel.
  useEffect(() => {
    /*
     * The same instant open a card click performs, and it must stay the same: a pin and a card are
     * two views of one row, so opening them by different mechanisms is how they drift.
     *
     * The row is looked up rather than passed, because a pin handler can only reach back through a
     * module-level callback. It is the row that lets the panel open populated. A viewport pin can be off the current page (#377); the panel
     * then loads the row itself.
     */
    _openListing = (id: string) =>
      openListingPanel(
        id,
        listings.find((l) => l.id === id),
      );
  }, [listings]);

  // Pins only ever come from rows that have coordinates — a seller-suppressed row (address,
  // latitude and longitude null together) is excluded here and nowhere else: it stays in
  // `listings` for the result count and the list view, it just never gets a marker.
  const pins = useMemo(() => selectMappableListings(listings), [listings]);
  const pinCoords = useMemo(() => toLatLngPairs(pins), [pins]);
  const hiddenPinCount = listings.length - pins.length;
  const rowsById = useMemo(() => new Map(listings.map((l) => [l.id, l])), [listings]);

  // Until the viewport request answers, or if it fails, the page's own rows are the pins.
  const [viewport, setViewport] = useState<MapResponse | null>(null);
  const pagePins = useMemo(
    () => pins.flatMap((l) => (hasMapCoordinates(l) ? [toPin(l)] : [])),
    [pins],
  );
  const mapPins = viewport === null ? pagePins : viewport.kind === 'pins' ? viewport.pins : [];
  const sampleBannerCopy = useMemo(
    () =>
      viewport === null
        ? getSampleBannerCopy(pins)
        : sampleBannerCopyFor(viewport.sampleCount, viewport.count),
    [viewport, pins],
  );
  // The list is the search area and the map is the viewport. Say so when they hold different sets.
  // A withheld-address home has no pin, so the copy counts pins, never homes in the area.
  const viewportNote =
    viewport !== null && typeof total === 'number' && viewport.count < total
      ? `${viewport.count.toLocaleString()} of ${total.toLocaleString()} homes have a pin in this map view. The list shows all ${total.toLocaleString()}.`
      : null;

  const center = useMemo<[number, number]>(() => {
    if (searchCenter) return searchCenter;
    const coords = grouped ? groupCoords : pinCoords;
    if (coords.length) {
      const lat = coords.reduce((s, [lat]) => s + lat, 0) / coords.length;
      const lng = coords.reduce((s, [, lng]) => s + lng, 0) / coords.length;
      return [lat, lng];
    }
    return [38.9072, -77.0369];
  }, [searchCenter, pinCoords, grouped, groupCoords]);

  const [scrollActive, setScrollActive] = useState(false);
  const { failed: tilesFailed, onTileError } = useTileFailure();
  const { tileUrl, attribution } = useTileLayerConfig();

  // The frame — radius, border, shadow, fill — belongs to the wrapper in `ListingsMap`, so that the
  // loading placeholder wears it too. This fills that frame and positions the overlays below.
  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={center}
        zoom={11}
        // Set here, not only on `<TileLayer>`: `leaflet.markercluster` reads the map's own
        // `maxZoom` to compute spiderfy behavior and throws "Map has no maxZoom specified" if it
        // mounts before `<TileLayer>` does — which now happens on every load, since the tile URL
        // arrives asynchronously from `/api/map-config` (#291).
        maxZoom={19}
        scrollWheelZoom={false}
        zoomControl={false}
        className="h-full w-full"
        style={{ background: '#f2ede6' }}
      >
        {/* Empty until `/api/map-config` answers — see `map-tiles.ts` for why this never
            defaults to a fallback URL client-side. */}
        {tileUrl && (
          <TileLayer
            attribution={attribution}
            url={tileUrl}
            // `L.TileLayer`'s own default `maxZoom` is 18, independent of the map's — leaving
            // this off would cap real tile fetches at z18 even though the map (above) allows 19,
            // silently upscaling the z18 tile past its native resolution.
            maxZoom={19}
            eventHandlers={{ tileerror: onTileError }}
          />
        )}
        <InvalidateOnMount />
        <CustomMapControls />
        <ClickToActivateScroll onChange={setScrollActive} />
        {/* Fit view to boundary, then pinned listings, then center — in priority order */}
        <FitView
          geojson={searchPolygon ?? null}
          coords={grouped ? groupCoords : pinCoords}
          center={searchCenter ?? null}
          bounds={grouped ? null : focusBounds}
        />
        {/* Searched area boundary outline */}
        <BoundaryLayer geojson={searchPolygon ?? null} />
        {grouped ? (
          <NeighborhoodMapLayer
            rows={groupMarkers}
            activeKey={neighborhoods.activeKey}
            onActive={neighborhoods.onActive}
            onSelect={neighborhoods.onSelect}
            onTapPreview={neighborhoods.onTapPreview}
          />
        ) : (
          <>
            {filters && <ViewportQuery filters={filters} onResult={setViewport} />}
            {viewport?.kind === 'clusters' && <ServerClusters clusters={viewport.clusters} />}
            <ClusteredMarkers
              pins={mapPins}
              rowsById={rowsById}
              activeId={activeId ?? null}
              savedIds={savedIds}
              onMarkerHover={onMarkerHover}
            />
          </>
        )}
      </MapContainer>
      {/*
       * The map itself is a listing display surface: a price pin and a cluster count are the row
       * being shown, before anyone clicks. So the sample label cannot live only in the popup —
       * PRD §6.3's rule is that if a sample row is visible, its label is visible, and today every
       * row is a sample, which makes the default map view a field of illustrative prices. This
       * overlay is persistent and needs no interaction, which is what the popup badge cannot be.
       */}
      {/* Tiles failed to load — surface it rather than leaving a silent blank map (#291). Ranks
          first: a broken basemap outranks the illustrative-price and hidden-pin notices below it. */}
      {/* One stack, so the notices never overlap whichever subset is showing. */}
      <div className="pointer-events-none absolute left-3 right-3 top-3 z-[400] flex flex-col gap-1.5">
        {tilesFailed && (
          <div className="rounded-2xl bg-ink/85 px-3 py-1.5 text-center text-[11px] font-semibold text-white shadow-card backdrop-blur">
            Map imagery is temporarily unavailable. Pin locations and prices below are unaffected.
          </div>
        )}
        {!grouped && sampleBannerCopy && (
          <div className="rounded-2xl bg-ink/85 px-3 py-1.5 text-center text-[11px] font-semibold text-white shadow-card backdrop-blur">
            {sampleBannerCopy}
          </div>
        )}
        {!grouped && hiddenPinCount > 0 && (
          <div className="rounded-2xl bg-surface/95 px-3 py-1.5 text-center text-[11px] font-medium text-ink-muted shadow-card backdrop-blur">
            Some sellers have chosen not to display their home’s location, so those homes appear in
            your results but not as pins on this map.
          </div>
        )}
        {!grouped && viewportNote && (
          <div className="rounded-2xl bg-surface/95 px-3 py-1.5 text-center text-[11px] font-medium text-ink-muted shadow-card backdrop-blur">
            {viewportNote}
          </div>
        )}
      </div>
      {!scrollActive && (
        <div className="pointer-events-none absolute bottom-6 left-1/2 z-[400] -translate-x-1/2 rounded-full bg-ink/85 px-4 py-1.5 text-xs font-semibold text-white shadow-card backdrop-blur">
          Click map to zoom with scroll
        </div>
      )}
    </div>
  );
}
