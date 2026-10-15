import { fetchWhereSuggestions } from '@/lib/where-suggest';

/**
 * City and state for the nearby list (#789).
 *
 * Nominatim is not called here. Its policy allows 1 request per second, so one lookup per result
 * made later results fail with 429. Each result is a named place from Overpass. Its state comes
 * from, in order: its own OSM tags, our listing data (`/api/listings/suggest`), the state of the
 * search center.
 */
function tagState(loc: any): string {
  const raw = String(loc['addr:state'] ?? loc['is_in:state_code'] ?? '').trim();
  return /^[A-Za-z]{2}$/.test(raw) ? raw.toUpperCase() : '';
}

export async function enrichNearbyLocal(
  results: any[],
  hintState: string,
  fetcher: typeof fetch = fetch,
): Promise<any[]> {
  return Promise.all(
    results.map(async (loc) => {
      const name = String(loc.display_name ?? '').trim();
      const fromTag = tagState(loc);
      if (fromTag) return { ...loc, address: { city: name, state_code: fromTag } };
      if (name && name !== 'Unnamed') {
        const found = await fetchWhereSuggestions(name, fetcher);
        if (found.status === 'ok') {
          const hit = found.suggestions.find(
            (s) => s.type === 'city' && String(s.name).toLowerCase() === name.toLowerCase(),
          );
          if (hit) return { ...loc, address: hit.address };
        }
      }
      return { ...loc, _hint_state: hintState };
    }),
  );
}
