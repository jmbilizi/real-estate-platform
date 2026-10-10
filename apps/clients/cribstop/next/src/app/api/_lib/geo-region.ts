import { fetchGateway } from '@/app/api/_lib/gateway';

/** City/state granularity only (#362, #363) — never coordinates or a postal code. */
export interface Region {
  city: string;
  state: string;
}

/** The gateway's raw `GET /geo/region` body (`GeoRegionResponse.cs`). */
interface GatewayGeoRegionBody {
  city?: string | null;
  region?: string | null;
  regionCode?: string | null;
  countryCode?: string | null;
}

/**
 * Narrows the gateway's response to a US city/state pair, or `null`.
 *
 * A non-US visitor, a body with no resolved city, or one with no ISO state code all yield `null` —
 * the licensed feed is Mid-Atlantic US only, so a non-US region has nothing to scope a row to.
 */
export function toRegion(body: GatewayGeoRegionBody | null): Region | null {
  if (!body || body.countryCode !== 'US') return null;
  if (!body.city || !body.regionCode) return null;
  return { city: body.city, state: body.regionCode };
}

/**
 * Fetches the visitor's region through the gateway, forwarding the client IP the gateway trusts.
 *
 * Sends the visitor IP as `X-Forwarded-For`. The gateway trusts that header from a peer in the pod
 * network and derives its own `X-Real-IP` from it. It overwrites any `X-Real-IP` sent here (#757).
 *
 * A 204, a network failure, a non-2xx, an unreadable body, or a non-US region all resolve to
 * `null` — the near-you row's contract has no error state of its own (#363).
 */
export async function fetchRegion(clientIp: string | null): Promise<Region | null> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (clientIp) headers['X-Forwarded-For'] = clientIp;

  const upstream = await fetchGateway('/geo/region', { method: 'GET', headers }, 5_000).catch(
    () => null,
  );
  if (!upstream || upstream.status === 204 || !upstream.ok) return null;

  const body = await upstream.json().catch(() => null);
  return toRegion(body);
}
