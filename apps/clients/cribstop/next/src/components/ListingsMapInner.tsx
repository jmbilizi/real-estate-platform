"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CustomMapControls } from "@/components/CustomMapControls";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { createRoot, type Root } from "react-dom/client";
import Link from "next/link";
import { Listing } from "@/lib/types";
import { formatPrice } from "@/lib/format";

const PILL_W = 70;
const PILL_H = 30;

function buildPriceIcon(price: string, active: boolean, saved: boolean) {
  // Red: #FF385C, Black: #222, White: #fff
  let tone;
  if (active) {
    tone = "background:#FF385C;color:#fff;border-color:#FF385C;transform:scale(1.1);z-index:1000;";
  } else if (saved) {
    tone = "background:#FF385C;color:#fff;border-color:#FF385C;";
  } else {
    tone = "background:#fff;color:#222;border-color:rgba(0,0,0,.15);";
  }
  return L.divIcon({
    className: "cribstop-price-marker",
    html: `<span style="${tone}display:inline-flex;align-items:center;justify-content:center;min-width:${PILL_W}px;height:${PILL_H}px;padding:0 10px;border-radius:9999px;border:1.5px solid;font:700 12px/1 Inter,system-ui,sans-serif;box-shadow:0 4px 16px rgba(34,34,34,0.18),0 1.5px 8px rgba(0,0,0,0.08);white-space:nowrap;cursor:pointer;transition:transform .15s;">${price}</span>`,
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
  const border = highlight ? "4px solid #FF385C" : "2.5px solid #bbb";
  const boxShadow = highlight
    ? "0 0 0 6px rgba(255,56,92,0.18),0 8px 24px rgba(34,34,34,0.18),0 1.5px 8px rgba(0,0,0,0.08)"
    : "0 8px 24px rgba(34,34,34,0.13),0 1.5px 8px rgba(0,0,0,0.06)";
  const bg = highlight ? "#fff" : "#fff";
  const color = highlight ? "#FF385C" : "#222";
  return L.divIcon({
    className: "cribstop-cluster",
    html: `<span style="background:${bg};color:${color};display:inline-flex;align-items:center;justify-content:center;width:42px;height:42px;border-radius:9999px;border:${border};font:800 13px/1 Inter,system-ui,sans-serif;box-shadow:${boxShadow};">${count}</span>`,
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
  listings: Listing[];
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
      const priceLabel =
        l.listingType === "rent"
          ? `$${(l.price / 1000).toFixed(1)}k`
          : l.price >= 1000000
            ? `$${(l.price / 1000000).toFixed(1)}M`
            : `$${Math.round(l.price / 1000)}k`;

      const marker = L.marker([l.latitude, l.longitude], {
        icon: buildPriceIcon(priceLabel, activeId === l.id, !!savedIds?.has(l.id)),
        // @ts-expect-error: custom property for cluster highlight
        listingId: l.id, // for cluster highlight
      });

      const popupEl = document.createElement("div");
      const root = createRoot(popupEl);
      root.render(<MarkerPopup listing={l} />);
      popupRootsRef.current.set(l.id, root);
      marker.bindPopup(popupEl, {
        closeButton: false,
        maxWidth: 260,
        minWidth: 240,
        autoPan: true,
      });

      marker.on("mouseover", () => onMarkerHover?.(l.id));
      marker.on("mouseout", () => onMarkerHover?.(null));

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
      const priceLabel =
        l.listingType === "rent"
          ? `$${(l.price / 1000).toFixed(1)}k`
          : l.price >= 1000000
            ? `$${(l.price / 1000000).toFixed(1)}M`
            : `$${Math.round(l.price / 1000)}k`;
      marker.setIcon(buildPriceIcon(priceLabel, activeId === l.id, !!savedIds?.has(l.id)));
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

function MarkerPopup({ listing }: { listing: Listing }) {
  return (
    <Link
      href={`/listing/${listing.id}`}
      className="block !p-0"
      style={{
        textDecoration: "none",
        color: "inherit",
        borderRadius: 18,
        boxShadow: "0 4px 24px rgba(34,34,34,0.13)",
        overflow: "hidden",
        background: "#fff",
        border: "1px solid #ececec",
        minWidth: 240,
        maxWidth: 260,
      }}
    >
      {}
      <img
        src={listing.imageUrls[0]}
        alt={listing.title}
        style={{
          width: "100%",
          height: 130,
          objectFit: "cover",
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
        }}
      />
      <div style={{ padding: "12px 16px 14px" }}>
        <p
          style={{
            margin: 0,
            fontWeight: 700,
            fontSize: 14,
            color: "#222",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            letterSpacing: 0.1,
          }}
        >
          {listing.neighborhood}, {listing.city}
        </p>
        <p
          style={{
            margin: "2px 0 0",
            fontSize: 12,
            color: "#717171",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {listing.address}
        </p>
        <p style={{ margin: "2px 0 0", fontSize: 12, color: "#717171" }}>
          {listing.beds} bd · {listing.baths} ba · {listing.sqft.toLocaleString()} sqft
        </p>
        <p style={{ margin: "8px 0 0", fontWeight: 800, fontSize: 15, color: "#222" }}>
          {formatPrice(listing.price, listing.listingType)}
        </p>
      </div>
    </Link>
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

    container.addEventListener("click", activate);
    document.addEventListener("click", deactivate);

    return () => {
      container.removeEventListener("click", activate);
      document.removeEventListener("click", deactivate);
    };
  }, [map, onChange]);
  return null;
}

// Helper to pan/zoom to a given lat/lng
// Single view controller: polygon bounds > listing bounds > center.
// Fires whenever the search polygon, listings, or center changes.
function FitView({
  geojson,
  listings,
  center,
}: {
  geojson: object | null;
  listings: Listing[];
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
    if (listings.length) {
      // Fall back to fitting listing marker positions
      const bounds = L.latLngBounds(listings.map((l) => [l.latitude, l.longitude] as [number, number]));
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [60, 60], maxZoom: 14, animate: true });
        return;
      }
    }
    if (center) {
      // Last resort: just pan to the geocoded point
      map.setView(center, 13, { animate: true });
    }
  }, [geojson, listings, center]);
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
        color: "#FF385C",
        weight: 2,
        opacity: 0.75,
        fillOpacity: 0.04,
        fillColor: "#FF385C",
        dashArray: "6 5",
        lineCap: "round",
        lineJoin: "round",
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
  listings: Listing[];
  activeId?: string | null;
  savedIds?: Set<string>;
  onMarkerHover?: (id: string | null) => void;
  className?: string;
  searchCenter?: [number, number] | null;
  searchPolygon?: object | null;
}

export default function ListingsMapInner({
  listings,
  activeId,
  savedIds,
  onMarkerHover,
  className,
  searchCenter,
  searchPolygon,
}: Props) {
  const center = useMemo<[number, number]>(() => {
    if (searchCenter) return searchCenter;
    if (listings.length) {
      const lat = listings.reduce((s, l) => s + l.latitude, 0) / listings.length;
      const lng = listings.reduce((s, l) => s + l.longitude, 0) / listings.length;
      return [lat, lng];
    }
    return [38.9072, -77.0369];
  }, [searchCenter, listings]);

  const [scrollActive, setScrollActive] = useState(false);

  return (
    <div
      className={`relative z-0 rounded-3xl overflow-hidden shadow-[0_8px_32px_rgba(34,34,34,0.18)] border border-neutral-200 bg-[#f7f7f7] ${className ?? ""}`}
      style={{
        boxShadow: "0 8px 32px rgba(34,34,34,0.18), 0 1.5px 8px rgba(0,0,0,0.08)",
        borderRadius: 28,
      }}
    >
      <MapContainer
        center={center}
        zoom={11}
        scrollWheelZoom={false}
        zoomControl={false}
        className="h-full w-full"
        style={{ background: "#f2ede6" }}
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
        {/* Fit view to boundary, then listings, then center — in priority order */}
        <FitView geojson={searchPolygon ?? null} listings={listings} center={searchCenter ?? null} />
        {/* Searched area boundary outline */}
        <BoundaryLayer geojson={searchPolygon ?? null} />
        <ClusteredMarkers
          listings={listings}
          activeId={activeId ?? null}
          savedIds={savedIds}
          onMarkerHover={onMarkerHover}
        />
      </MapContainer>
      {!scrollActive && (
        <div className="pointer-events-none absolute bottom-6 left-1/2 z-[400] -translate-x-1/2 rounded-full bg-ink/85 px-4 py-1.5 text-xs font-semibold text-white shadow-pop backdrop-blur">
          Click map to zoom with scroll
        </div>
      )}
    </div>
  );
}
