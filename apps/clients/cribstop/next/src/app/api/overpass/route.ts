import { NextRequest } from 'next/server';

// Proxies OpenStreetMap Overpass API requests for nearby place lookups.
// Overpass does not reliably emit CORS headers so it cannot be called directly from the browser.
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

const PLACE_TYPES = new Set(['city', 'town', 'village']);

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const lat = Number(searchParams.get('lat'));
  const lon = Number(searchParams.get('lon'));
  const placeType = searchParams.get('placeType') || '';
  const radiusMeters = Number(searchParams.get('radiusMeters') ?? 20000);

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !PLACE_TYPES.has(placeType)) {
    return new Response(JSON.stringify({ error: 'Invalid parameters' }), { status: 400 });
  }

  const query = `
    [out:json][timeout:10];
    (
      node[place=${placeType}](around:${radiusMeters},${lat},${lon});
    );
    out body center 20;
  `;

  try {
    const upstream = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'real-estate-platform/1.0',
      },
      body: `data=${encodeURIComponent(query)}`,
    });

    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: 'Upstream error' }), { status: 502 });
    }

    const data = await upstream.json();
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[Overpass] Upstream request failed', e);
    return new Response(JSON.stringify({ error: 'Upstream unavailable' }), { status: 502 });
  }
}
