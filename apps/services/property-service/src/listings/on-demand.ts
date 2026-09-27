import type { SearchRequest } from '@cribstop/property-contracts';

/**
 * Place parsing for free-text search: `query=Frederick, MD` becomes `city=Frederick&state=MD`.
 * No stored column holds the whole string, so the search runs against the parsed place.
 */

/** The place a search names, or `null` when it names none. */
export interface Area {
  readonly city?: string;
  readonly state?: string;
  readonly zip?: string;
}

const ZIP = /^\d{5}$/;
const PLACE = /^[A-Za-z][A-Za-z .'-]{1,59}$/;

/**
 * Matches `City, ST`, `City ST`, or `City, ST 12345`, anchored on the string end.
 *
 * The trailing two-letter token is read as a state, the same way the `state` query parameter
 * itself is (`stateCode` in `search-request.ts`). Any two letters count. There is no real-state
 * lookup.
 *
 * The end anchor keeps this narrow. A city whose last word is not exactly two letters, such as
 * `Ocean City` or `New York`, never matches here. It falls through to the bare-city form below.
 */
const CITY_STATE_ZIP = /^([A-Za-z][A-Za-z .'-]*?)[,\s]+([A-Za-z]{2})(?:[,\s]+(\d{5}))?$/;

/** Bright stores city names capitalised ("Silver Spring"); search input arrives in any case. */
export function titleCase(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/(^|[\s-])([a-z])/g, (_, lead: string, letter: string) => lead + letter.toUpperCase());
}

/** A city, with an optional state and ZIP, parsed out of free text such as `query`. */
function placeOf(text: string): Area | null {
  const match = CITY_STATE_ZIP.exec(text);
  if (match !== null) {
    const [, city, state, zip] = match;
    return {
      city: titleCase(city as string),
      state: (state as string).toUpperCase(),
      ...(zip === undefined ? {} : { zip }),
    };
  }
  return PLACE.test(text) ? { city: titleCase(text) } : null;
}

export function areaOf(request: SearchRequest): Area | null {
  const explicitState = request.state?.toUpperCase();
  const withExplicitState = explicitState === undefined ? {} : { state: explicitState };

  if (request.zip !== undefined && ZIP.test(request.zip.trim())) {
    return { zip: request.zip.trim(), ...withExplicitState };
  }
  if (request.city !== undefined && PLACE.test(request.city.trim())) {
    return { city: titleCase(request.city), ...withExplicitState };
  }

  const query = request.query?.trim();
  if (query === undefined) {
    return null;
  }
  if (ZIP.test(query)) {
    return { zip: query, ...withExplicitState };
  }
  const place = placeOf(query);
  if (place === null) {
    return null;
  }
  // An explicit `state` parameter sent alongside a free-text `query` wins over any state the query
  // text itself carried.
  return { ...place, ...withExplicitState };
}

/** `Area`'s fields, shaped for a search request. */
function placeFields(area: Area): Pick<SearchRequest, 'city' | 'state' | 'zip'> {
  return {
    ...(area.city === undefined ? {} : { city: area.city }),
    ...(area.state === undefined ? {} : { state: area.state }),
    ...(area.zip === undefined ? {} : { zip: area.zip }),
  };
}

/**
 * `request`, with a free-text `query` swapped for the place `areaOf()` parsed out of it.
 *
 * The swap runs only when that place carries a state the query text itself supplied. No stored
 * column ever holds `"Frederick, MD"` as one string. `search-query.ts`'s substring match on `query`
 * can never find a row there. A bare-city or ZIP query
 * keeps matching by substring as before, because `areaOf()` never derives a state from either of
 * those.
 *
 * Never swaps when the caller sent an explicit `state`. `query` and `state` then stay two
 * independent ANDed filters, per the divergence noted in `search-query.ts`.
 */
export function resolvedSearchRequest(request: SearchRequest): SearchRequest {
  const area = areaOf(request);
  if (area === null || area.state === undefined || request.state !== undefined) {
    return request;
  }
  return { ...request, query: undefined, ...placeFields(area) };
}
