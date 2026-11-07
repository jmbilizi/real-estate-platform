/**
 * The display time zone of a listing that lies in a minority zone of its state (#983).
 *
 * The web app holds one zone per state (#79). That table is right for most of a state. This
 * module returns a zone only where a point or a ZIP lies outside that table zone. It returns
 * `undefined` everywhere else, so the web app falls back to its state table.
 *
 * Coordinates decide first. Boundary lines are approximate. A point within a few miles of a
 * zone line can resolve to the neighbouring zone. A listing with no coordinates (the seller hid
 * the address) falls back to its ZIP prefix. A listing with neither gets no zone.
 *
 * States that split along county lines with no clean coordinate line (IN, KY, TN, ND, and the
 * Navajo Nation in AZ) are not covered. They keep the state-table zone.
 */

const MOUNTAIN = 'America/Denver';
const CENTRAL = 'America/Chicago';

interface Point {
  latitude: number;
  longitude: number;
}

/** A rule for one state. It returns the zone for a point inside its area, else `undefined`. */
type PointRule = (point: Point) => string | undefined;

const POINT_RULES: Readonly<Record<string, PointRule>> = {
  // El Paso and Hudspeth counties.
  TX: ({ longitude }) => (longitude <= -105.0 ? MOUNTAIN : undefined),
  // The panhandle west of the Apalachicola River. Port St. Joe and the Gulf County coast east of
  // Mexico Beach stay Eastern.
  FL: ({ latitude, longitude }) => {
    if (longitude >= -85.0) return undefined;
    if (latitude < 30.05 && longitude > -85.4) return undefined;
    return CENTRAL;
  },
  // The western Upper Peninsula: Gogebic, Iron, Dickinson and Menominee counties.
  MI: ({ latitude, longitude }) => (latitude > 45.0 && longitude <= -87.58 ? CENTRAL : undefined),
  // Sherman, Wallace, Greeley and Hamilton counties.
  KS: ({ longitude }) => (longitude <= -101.5 ? MOUNTAIN : undefined),
  // The panhandle west of Keith County.
  NE: ({ longitude }) => (longitude <= -102.05 ? MOUNTAIN : undefined),
  // West of the Missouri River bend, Rapid City and the Black Hills.
  SD: ({ longitude }) => (longitude <= -101.0 ? MOUNTAIN : undefined),
  // Malheur County.
  OR: ({ latitude, longitude }) =>
    latitude < 44.4 && longitude >= -117.7 ? 'America/Boise' : undefined,
  // The panhandle north of the Salmon River.
  ID: ({ latitude }) => (latitude >= 45.8 ? 'America/Los_Angeles' : undefined),
  // West Wendover.
  NV: ({ latitude, longitude }) => (latitude > 40.5 && longitude >= -114.2 ? MOUNTAIN : undefined),
};

/** ZIP prefixes of the minority-zone areas above, for a listing with no coordinates. */
const ZIP_RULES: Readonly<Record<string, readonly { prefix: string; zone: string }[]>> = {
  TX: [
    { prefix: '799', zone: MOUNTAIN },
    { prefix: '885', zone: MOUNTAIN },
  ],
  FL: [
    { prefix: '325', zone: CENTRAL },
    { prefix: '3240', zone: CENTRAL },
    { prefix: '3241', zone: CENTRAL },
  ],
};

export interface TimeZoneInput {
  state: string;
  zip: string;
  latitude: number | null;
  longitude: number | null;
}

/** The IANA zone for a listing in a minority zone of its state, else `undefined`. */
export function deriveTimeZone(input: TimeZoneInput): string | undefined {
  const state = input.state.trim().toUpperCase();
  if (input.latitude !== null && input.longitude !== null) {
    return POINT_RULES[state]?.({ latitude: input.latitude, longitude: input.longitude });
  }
  const zip = input.zip.trim();
  return ZIP_RULES[state]?.find((rule) => zip.startsWith(rule.prefix))?.zone;
}
