'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CustomMapControls } from '@/components/CustomMapControls';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { createRoot, type Root } from 'react-dom/client';
import { ListingCardRow } from '@/lib/types';
import {
  formatClosePrice,
  formatDwellingStats,
  formatListingLocation,
  formatListingPrice,
  formatLotSize,
  formatStreetAddress,
  hasMapCoordinates,
} from '@/lib/listing-format';
import ListingImage from '@/components/listing/ListingImage';
import { SampleBadge, SponsoredBadge } from '@/components/listing/ListingBadges';
import ListingAttribution from '@/components/listing/ListingAttribution';

// Module-level callback set by ListingsMapInner so MarkerPopup
// (rendered in a separate createRoot) can still trigger modal navigation.
let _openListing: ((id: string) => void) | null = null;

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
 * popup renders the full withheld sentence via `formatListingPrice`.
 */
function pinPriceLabel(listing: ListingCardRow): string {
  const { price, listingType } = listing;
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

function ClusteredMarkers({
  listings,
  activeId,
  savedIds,
  onMarkerHover,
}: {
  /** Expected to already be pin-eligible (see `selectMappableListings`); re-checked defensively below. */
  listings: ListingCardRow[];
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

    listings.forEach((l) => {
      // No pin without coordinates — defensive re-check even though the caller already filters
      // with `selectMappableListings`. Never fall back to a city/ZIP centroid here.
      if (!hasMapCoordinates(l)) return;

      const marker = L.marker([l.latitude, l.longitude], {
        icon: buildPriceIcon(pinPriceLabel(l), activeId === l.id, !!savedIds?.has(l.id)),
        // @ts-expect-error: custom property for cluster highlight
        listingId: l.id, // for cluster highlight
      });

      const popupEl = document.createElement('div');
      const root = createRoot(popupEl);
      root.render(<MarkerPopup listing={l} />);
      popupRootsRef.current.set(l.id, root);
      marker.bindPopup(popupEl, {
        closeButton: false,
        maxWidth: 260,
        minWidth: 240,
        autoPan: true,
      });

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
  }, [listings]);

  // Lightweight effect: just update each marker's icon when activeId / savedIds change.
  // No cluster rebuild, no map pan, no flicker.
  useEffect(() => {
    listings.forEach((l) => {
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
  }, [activeId, savedIds, listings]);

  return null;
}

/**
 * The map popup is a listing display surface, so it carries the same obligations the card does:
 * sample labelling wherever the row is visible, sponsored disclosure, and NAR 7.58 attribution
 * (agent name + a contact method + office name). Every nullable field is run through the shared
 * `lib/listing-format` helpers rather than read raw, so a null never reaches the DOM as a blank,
 * a bare comma, or a fabricated `$0`.
 */
function MarkerPopup({ listing }: { listing: ListingCardRow }) {
  const isSold = listing.listingType === 'sold' || listing.status === 'Sold';
  const isParcel = listing.propertyType === 'Land';

  const title = formatListingLocation(listing.neighborhood, listing.city, listing.state);
  const address = formatStreetAddress(listing.address, listing.city, listing.state, listing.zip);
  const statsLine = isParcel
    ? formatLotSize(listing.lotSqft)
    : formatDwellingStats(listing.beds, listing.baths, listing.sqft);
  const price = formatListingPrice(listing.price, listing.listingType);
  const soldLine = isSold ? formatClosePrice(listing.closePrice, listing.closeDate) : null;

  return (
    <div
      onClick={() => _openListing?.(listing.id)}
      className="min-w-[240px] max-w-[260px] cursor-pointer overflow-hidden rounded-[18px] border border-surface-border bg-surface shadow-card"
      style={{ textDecoration: 'none', color: 'inherit' }}
    >
      <div className="relative h-[130px] w-full bg-surface-soft">
        <ListingImage media={listing.primaryMedia} className="h-full w-full object-cover" />
        {/* Required disclosure labels — never crowded out, shown whenever the row is. */}
        {(listing.isSample || listing.sponsored) && (
          <div className="absolute left-2 top-2 flex flex-wrap items-center gap-1">
            {listing.isSample && <SampleBadge />}
            {listing.sponsored && <SponsoredBadge />}
          </div>
        )}
      </div>
      <div className="px-4 py-3">
        <p className="truncate text-sm font-bold tracking-wide text-ink">{title}</p>
        {address && <p className="mt-0.5 truncate text-xs text-ink-muted">{address}</p>}
        {statsLine && <p className="mt-0.5 text-xs text-ink-muted">{statsLine}</p>}
        {/* The withheld sentence is prose, not a figure — styling it as a number reads as one. */}
        <p
          className={
            soldLine || !price.isWithheld
              ? 'mt-2 text-[15px] font-extrabold text-ink'
              : 'mt-2 text-xs text-ink-body'
          }
        >
          {soldLine ?? price.text}
        </p>
        {/* NAR 7.58 applies to every display surface, this popup included. */}
        {/* Source-driven, like the card: a popup is a cramped surface, and 7.58 attaches to IDX rows. */}
        <ListingAttribution attribution={listing} source={listing.source} className="mt-2" />
      </div>
    </div>
  );
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
}: {
  geojson: object | null;
  /** Pin coordinates only — rows without them never contribute a fabricated centroid to the fit. */
  coords: [number, number][];
  center: [number, number] | null;
}) {
  const map = useMap();
  useEffect(() => {
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
  }, [geojson, coords, center]);
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
}

export default function ListingsMapInner({
  listings,
  activeId,
  savedIds,
  onMarkerHover,
  searchCenter,
  searchPolygon,
}: Props) {
  const router = useRouter();

  // Keep the module-level callback up to date so MarkerPopup popups
  // (rendered in separate React roots) can open the listing modal.
  useEffect(() => {
    // The listing's own URL, intercepted into a modal over the map — same as a card click.
    _openListing = (id: string) => router.push(`/listing/${id}`, { scroll: false });
  }, [router]);

  // Pins only ever come from rows that have coordinates — a seller-suppressed row (address,
  // latitude and longitude null together) is excluded here and nowhere else: it stays in
  // `listings` for the result count and the list view, it just never gets a marker.
  const pins = useMemo(() => selectMappableListings(listings), [listings]);
  const pinCoords = useMemo(() => toLatLngPairs(pins), [pins]);
  const hiddenPinCount = listings.length - pins.length;

  const center = useMemo<[number, number]>(() => {
    if (searchCenter) return searchCenter;
    if (pinCoords.length) {
      const lat = pinCoords.reduce((s, [lat]) => s + lat, 0) / pinCoords.length;
      const lng = pinCoords.reduce((s, [, lng]) => s + lng, 0) / pinCoords.length;
      return [lat, lng];
    }
    return [38.9072, -77.0369];
  }, [searchCenter, pinCoords]);

  const [scrollActive, setScrollActive] = useState(false);

  // The frame — radius, border, shadow, fill — belongs to the wrapper in `ListingsMap`, so that the
  // loading placeholder wears it too. This fills that frame and positions the overlays below.
  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={center}
        zoom={11}
        scrollWheelZoom={false}
        zoomControl={false}
        className="h-full w-full"
        style={{ background: '#f2ede6' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          subdomains="abcd"
          maxZoom={20}
        />
        <InvalidateOnMount />
        <CustomMapControls />
        <ClickToActivateScroll onChange={setScrollActive} />
        {/* Fit view to boundary, then pinned listings, then center — in priority order */}
        <FitView geojson={searchPolygon ?? null} coords={pinCoords} center={searchCenter ?? null} />
        {/* Searched area boundary outline */}
        <BoundaryLayer geojson={searchPolygon ?? null} />
        <ClusteredMarkers
          listings={pins}
          activeId={activeId ?? null}
          savedIds={savedIds}
          onMarkerHover={onMarkerHover}
        />
      </MapContainer>
      {/*
       * The map itself is a listing display surface: a price pin and a cluster count are the row
       * being shown, before anyone clicks. So the sample label cannot live only in the popup —
       * PRD §6.3's rule is that if a sample row is visible, its label is visible, and today every
       * row is a sample, which makes the default map view a field of illustrative prices. This
       * overlay is persistent and needs no interaction, which is what the popup badge cannot be.
       */}
      {pins.some((listing) => listing.isSample) && (
        <div className="pointer-events-none absolute left-3 right-3 top-3 z-[400] rounded-2xl bg-ink/85 px-3 py-1.5 text-center text-[11px] font-semibold text-white shadow-card backdrop-blur">
          Sample data — prices shown on this map are illustrative.
        </div>
      )}
      {hiddenPinCount > 0 && (
        <div
          className={`pointer-events-none absolute left-3 right-3 z-[400] rounded-2xl bg-surface/95 px-3 py-1.5 text-center text-[11px] font-medium text-ink-muted shadow-card backdrop-blur ${
            pins.some((listing) => listing.isSample) ? 'top-12' : 'top-3'
          }`}
        >
          Some sellers have chosen not to display their home’s location, so those homes appear in
          your results but not as pins on this map.
        </div>
      )}
      {!scrollActive && (
        <div className="pointer-events-none absolute bottom-6 left-1/2 z-[400] -translate-x-1/2 rounded-full bg-ink/85 px-4 py-1.5 text-xs font-semibold text-white shadow-card backdrop-blur">
          Click map to zoom with scroll
        </div>
      )}
    </div>
  );
}
