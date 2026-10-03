'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CustomMapControls } from '@/components/CustomMapControls';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { MapPin, MapResponse, NeighborhoodRow } from '@cribstop/property-contracts';
import NeighborhoodMapLayer, {
  selectMappableNeighborhoods,
} from '@/components/NeighborhoodMapLayer';
import type { ListingCardRow } from '@/lib/types';
import { getListingsMap, type ListingSearchQuery } from '@/lib/api/listings';
import { hasMapCoordinates } from '@/lib/listing-format';
import PricePinLayer from '@/components/PricePinLayer';
import { useTileFailure, useTileLayerConfig } from '@/components/map-tiles';

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

/** The same copy from counts, for server pins that carry no per-row flag. */
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

/**
 * Requests the viewport pins on load, on every pan or zoom (debounced), and on
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
      // The outline is a picture. An interactive polygon sits above the canvas dots and takes
      // their hover and tap events.
      interactive: false,
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
  /** Grouped view (#503): one marker per neighborhood replaces the listing pins. */
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
  // Pins only ever come from rows that have coordinates — a seller-suppressed row (address,
  // latitude and longitude null together) is excluded here and nowhere else: it stays in
  // `listings` for the result count and the list view, it just never gets a marker.
  const pins = useMemo(() => selectMappableListings(listings), [listings]);
  const pinCoords = useMemo(() => toLatLngPairs(pins), [pins]);
  const hiddenPinCount = listings.length - pins.length;

  // Until the viewport request answers, or if it fails, the page's own rows are the pins.
  const [viewport, setViewport] = useState<MapResponse | null>(null);
  const pagePins = useMemo(
    () => pins.flatMap((l) => (hasMapCoordinates(l) ? [toPin(l)] : [])),
    [pins],
  );
  const mapPins = viewport === null ? pagePins : viewport.pins;
  const sampleBannerCopy = useMemo(
    () =>
      viewport === null
        ? getSampleBannerCopy(pins)
        : sampleBannerCopyFor(viewport.sampleCount, viewport.pins.length),
    [viewport, pins],
  );
  // A pin opens the card popup (#549). A home on this page shows its row. Any other pin loads its
  // card. Only a click on the card opens the detail.
  const rowsById = useMemo(() => new Map(listings.map((l) => [l.id, l])), [listings]);
  // The list is the search area and the map is the viewport. Say so when they hold different sets.
  // Over the cap the map holds the newest homes only. A withheld-address home has no pin, so the
  // copy counts pins, never homes in the area.
  const viewportNote =
    viewport === null
      ? null
      : viewport.total > viewport.pins.length
        ? `Showing the newest ${viewport.pins.length.toLocaleString()} of ${viewport.total.toLocaleString()} homes in this map view. Zoom in to see the rest.`
        : typeof total === 'number' && viewport.total < total
          ? `${viewport.total.toLocaleString()} of ${total.toLocaleString()} homes have a pin in this map view. The list shows all ${total.toLocaleString()}.`
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
        // Set on the map, not only on `<TileLayer>`: the tile URL arrives asynchronously from
        // `/api/map-config` (#291), so the map has no tile layer to supply a max zoom at first.
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
            <PricePinLayer
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
       * The map itself is a listing display surface: a price pin is the row
       * being shown, before anyone clicks. So the sample label cannot live only in the popup —
       * PRD §6.3's rule is that if a sample row is visible, its label is visible, and today every
       * row is a sample, which makes the default map view a field of illustrative prices. This
       * overlay is persistent and needs no interaction, which is what the popup badge cannot be.
       */}
      {/* Tiles failed to load — surface it rather than leaving a silent blank map (#291). Ranks
          first: a broken basemap outranks the illustrative-price and hidden-pin notices below it. */}
      {/* One stack, so the notices never overlap whichever subset is showing. `right-20` keeps it
          clear of the zoom and fullscreen controls, which sit in the top right corner. */}
      <div className="pointer-events-none absolute left-3 right-20 top-3 z-[400] flex flex-col gap-1.5">
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
        {!grouped && (hiddenPinCount > 0 || viewportNote) && (
          <div className="flex flex-col gap-1 rounded-2xl bg-surface/95 px-3 py-1.5 text-center text-[11px] font-medium leading-snug text-ink-muted shadow-card backdrop-blur">
            {viewportNote && <p>{viewportNote}</p>}
            {hiddenPinCount > 0 && (
              <p>
                Some sellers have chosen not to display their home’s location, so those homes appear
                in your results but not as pins on this map.
              </p>
            )}
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
