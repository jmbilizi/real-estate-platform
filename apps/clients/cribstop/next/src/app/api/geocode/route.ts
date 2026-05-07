import { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q');
  if (!q || typeof q !== 'string') {
    return new Response(JSON.stringify({ error: 'Missing query' }), { status: 400 });
  }
  const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&countrycodes=us&q=${encodeURIComponent(q)}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'real-estate-platform/1.0',
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    return new Response(JSON.stringify({ error: 'Upstream error' }), { status: 502 });
  }
  const data = await response.json();
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
