/**
 * The display time zone of a listing that lies in a minority zone of its state (#983).
 *
 * The web app holds one zone per state (#79). That table is right for most of a state. This
 * module returns a zone only where a point or a ZIP lies outside that table zone. It returns
 * `undefined` everywhere else, so the web app falls back to its state table.
 *
 * Coordinates decide first. Boundary lines are approximate. A point within a few miles of a
 * zone line can resolve to the neighbouring zone. A listing with no coordinates (the seller hid
 * the address) falls back to its ZIP prefix. Only TX, FL and ID have ZIP rules. A hidden-address
 * listing in another state, or with no matching ZIP, gets no zone and keeps the state-table zone.
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
    // Jackson County, north of 30.55, lies west of a river that bends east of -85.0 (Sneads).
    // Gadsden County (Chattahoochee) lies east of it and stays Eastern.
    if (latitude >= 30.55) return longitude <= -84.88 ? CENTRAL : undefined;
    if (longitude >= -85.0) return undefined;
    if (latitude < 30.05 && longitude > -85.4) return undefined;
    return CENTRAL;
  },
  // The four Central counties of the Upper Peninsula: Gogebic, Iron, Dickinson and Menominee.
  // Houghton, Baraga, Keweenaw, Ontonagon and Marquette lie north and stay Eastern, so each county
  // gets its own latitude limit. Ontonagon's southern edge is approximate.
  MI: ({ latitude, longitude }) => {
    if (latitude <= 45.0) return undefined;
    const gogebic = longitude <= -89.1 && latitude <= 46.6;
    const iron = longitude <= -88.0 && latitude <= 46.4;
    const dickinson = longitude <= -87.58 && latitude <= 46.2;
    const menominee = longitude <= -87.33 && latitude <= 45.8;
    return gogebic || iron || dickinson || menominee ? CENTRAL : undefined;
  },
  // Sherman, Wallace, Greeley and Hamilton counties. Cheyenne County to the north stays Central.
  KS: ({ latitude, longitude }) =>
    longitude <= -101.5 && latitude >= 37.75 && latitude < 39.57 ? MOUNTAIN : undefined,
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
const ZIP_RULES: Readonly<Record<string, readonly { prefix: string; zone?: string }[]>> = {
  TX: [
    { prefix: '799', zone: MOUNTAIN },
    { prefix: '885', zone: MOUNTAIN },
    // El Paso and Hudspeth county towns with a 798 ZIP: Anthony, Canutillo, Clint, Dell City,
    // Fabens, Fort Hancock, Salt Flat, San Elizario, Sierra Blanca and Tornillo. Van Horn, Marfa,
    // Alpine and Presidio also start with 798 and stay Central.
    ...[
      '79821',
      '79835',
      '79836',
      '79837',
      '79838',
      '79839',
      '79847',
      '79849',
      '79851',
      '79853',
    ].map((prefix) => ({ prefix, zone: MOUNTAIN })),
  ],
  FL: [
    // Port St. Joe stays Eastern. The first matching rule wins, and a rule with no zone ends the search.
    { prefix: '32456' },
    { prefix: '324', zone: CENTRAL },
    { prefix: '325', zone: CENTRAL },
  ],
  // The panhandle: every 838 ZIP, plus Lewiston.
  ID: [
    { prefix: '838', zone: 'America/Los_Angeles' },
    { prefix: '83501', zone: 'America/Los_Angeles' },
    { prefix: '83502', zone: 'America/Los_Angeles' },
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
