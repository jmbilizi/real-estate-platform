import { NextRequest } from 'next/server';

// Proxies US Census TIGER/Web ZCTA (ZIP Code Tabulation Area) boundary requests.
// The Census API does not emit CORS headers so it cannot be called directly from the browser.
const TIGER_URL =
  'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/1/query';

export async function GET(req: NextRequest) {
  const zip = req.nextUrl.searchParams.get('zip');
  if (!zip || !/^\d{5}$/.test(zip)) {
    return new Response(JSON.stringify({ error: 'Invalid zip' }), { status: 400 });
  }

  const url = `${TIGER_URL}?where=ZCTA5%3D%27${zip}%27&outFields=ZCTA5&f=geojson&outSR=4326`;

  const upstream = await fetch(url, {
    headers: { 'User-Agent': 'real-estate-platform/1.0' },
    next: { revalidate: 86400 }, // cache ZCTA shapes for 24 h — they never change
  });

  if (!upstream.ok) {
    return new Response(JSON.stringify({ error: 'Upstream error' }), { status: 502 });
  }

  const data = await upstream.json();
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
