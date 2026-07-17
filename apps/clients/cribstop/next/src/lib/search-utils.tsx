import React from 'react';

// US state name → 2-letter abbreviation
export const US_STATE_ABBR: Record<string, string> = {
  Alabama: 'AL',
  Alaska: 'AK',
  Arizona: 'AZ',
  Arkansas: 'AR',
  California: 'CA',
  Colorado: 'CO',
  Connecticut: 'CT',
  Delaware: 'DE',
  'District of Columbia': 'DC',
  Florida: 'FL',
  Georgia: 'GA',
  Hawaii: 'HI',
  Idaho: 'ID',
  Illinois: 'IL',
  Indiana: 'IN',
  Iowa: 'IA',
  Kansas: 'KS',
  Kentucky: 'KY',
  Louisiana: 'LA',
  Maine: 'ME',
  Maryland: 'MD',
  Massachusetts: 'MA',
  Michigan: 'MI',
  Minnesota: 'MN',
  Mississippi: 'MS',
  Missouri: 'MO',
  Montana: 'MT',
  Nebraska: 'NE',
  Nevada: 'NV',
  'New Hampshire': 'NH',
  'New Jersey': 'NJ',
  'New Mexico': 'NM',
  'New York': 'NY',
  'North Carolina': 'NC',
  'North Dakota': 'ND',
  Ohio: 'OH',
  Oklahoma: 'OK',
  Oregon: 'OR',
  Pennsylvania: 'PA',
  'Rhode Island': 'RI',
  'South Carolina': 'SC',
  'South Dakota': 'SD',
  Tennessee: 'TN',
  Texas: 'TX',
  Utah: 'UT',
  Vermont: 'VT',
  Virginia: 'VA',
  Washington: 'WA',
  'West Virginia': 'WV',
  Wisconsin: 'WI',
  Wyoming: 'WY',
};

export function stateAbbr(name: string): string {
  return US_STATE_ABBR[name] || name || '';
}

// Split into primary (the identifier the user searched for) and secondary (context).
export function getLocationParts(loc: any): { primary: string; secondary: string } {
  const address = loc.address || {};
  const houseNumber = address.house_number || '';
  const road = address.road || '';
  const suburb = address.suburb || address.neighbourhood || address.quarter || '';
  const city = address.city || address.town || address.village || address.hamlet || '';
  const raw = address.state || '';
  const st = address.state_code || stateAbbr(raw);
  const zip = address.postcode || '';
  const country = address.country || '';
  const isUS = !country || country === 'United States';
  const cityState = [city, st].filter(Boolean).join(', ');
  const cityStateZip = zip ? `${cityState} ${zip}`.trim() : cityState;

  if (houseNumber && road) {
    return { primary: `${houseNumber} ${road}`, secondary: cityStateZip };
  }

  if (loc.type === 'postcode') {
    const z = zip || loc.display_name?.split(',')[0]?.trim() || '';
    return { primary: z, secondary: cityState };
  }

  if (road) {
    return { primary: road, secondary: cityState };
  }

  if (suburb && city) {
    return { primary: suburb, secondary: cityState };
  }

  if (city) {
    const nonUsCountry = !isUS ? country : '';
    return { primary: city, secondary: [st, nonUsCountry].filter(Boolean).join(', ') };
  }

  const fallbackState = loc._hint_state || '';
  const displayName = loc.display_name || '';
  return { primary: displayName, secondary: fallbackState };
}

// Build standard US-format label → always a single line.
export function formatLocationLabel(loc: any): string {
  const { primary, secondary } = getLocationParts(loc);
  if (!primary) return '';
  if (!secondary) return primary;
  if (loc.type === 'postcode') return `${secondary} ${primary}`;
  return `${primary}, ${secondary}`;
}

// Extract precise search identifiers
export function extractSearchTerms(loc: any): { zip?: string; street?: string } {
  const address = loc.address || {};
  const result: { zip?: string; street?: string } = {};
  if (loc.type === 'postcode' && address.postcode) result.zip = address.postcode;
  if ((loc.type === 'road' || loc.type === 'house' || loc.type === 'residential') && address.road) {
    result.street = address.house_number ? `${address.house_number} ${address.road}` : address.road;
  }
  return result;
}

// Highlight the portion of `text` that matches `query` (case-insensitive).
export function highlightMatch(text: string, query: string): React.ReactNode {
  const q = query?.trim();
  if (!q) return <span className="font-semibold">{text}</span>;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return <span className="font-semibold">{text}</span>;
  return (
    <>
      {text.slice(0, idx)}
      <span className="font-semibold">{text.slice(idx, idx + q.length)}</span>
      {text.slice(idx + q.length)}
    </>
  );
}

// Fetch nearby cities/towns/villages from Overpass API
export async function fetchNearbyLocationsByType(
  lat: number,
  lon: number,
  placeType: 'city' | 'town' | 'village',
  radiusMeters = 20000,
  signal?: AbortSignal,
): Promise<any[]> {
  const query = `
    [out:json][timeout:10];
    (
      node[place=${placeType}](around:${radiusMeters},${lat},${lon});
    );
    out body center 20;
  `;
  try {
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'real-estate-platform/1.0',
      },
      body: `data=${encodeURIComponent(query)}`,
      signal,
    });
    if (!response.ok) {
      console.warn('[Overpass] API returned', response.status);
      return [];
    }
    const data = await response.json();
    if (!data.elements) return [];
    return data.elements.map((el: any) => ({
      display_name: el.tags?.name || 'Unnamed',
      lat: el.lat,
      lon: el.lon,
      type: el.tags?.place,
      ...el.tags,
    }));
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    console.error('[Overpass] Nearby fetch failed', e);
    return [];
  }
}
