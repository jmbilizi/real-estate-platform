import { closePool, getPool } from '../src/db/pool';
import { complianceFixtureIds } from './support/fixture-ids';

/**
 * The seller address opt-out, asserted against the VIEW rather than against the HTTP response.
 *
 * Every other spec in this suite goes through the API, which enumerates its columns and therefore
 * cannot observe a leak in a column it never selects. That is exactly the hole #48 was: the view
 * masked `address`/`latitude`/`longitude` and then projected the raw `street_line` three columns
 * later, and the only thing keeping it out of a consumer payload was one service's discipline about
 * never writing `SELECT *`. The view is the platform's single enforcement point for the opt-out
 * precisely so that no caller has to be that disciplined, so the guarantee has to be tested where
 * it is made.
 *
 * `SELECT *` here is deliberate and is the OPPOSITE of the rule it appears to break. Production
 * code enumerates its columns so that an unmasked value never enters the process; this spec reads
 * every column specifically to prove there is no unmasked value left to enter it.
 *
 * WHOLE ROW, NOT AN ALLOW-LIST. The assertions below iterate `Object.entries(row)` rather than
 * naming the columns they distrust. A test that checked "column X is null" would keep passing when
 * someone adds column Y carrying the same street line — which is precisely how #48 was introduced
 * in the first place. Here a newly added leaking column fails the test on the day it is added.
 */
const fixtures = complianceFixtureIds();

/**
 * The shortest a needle may be before a substring scan across a whole row stops meaning anything.
 * Enforced by the first describe below; the fixture values are chosen to clear it deliberately.
 */
const MIN_NEEDLE_LENGTH = 3;

/** The strings that, appearing anywhere in the row, would mean the opt-out failed. */
const IDENTIFYING_VALUES: ReadonlyArray<{ label: string; needle: string }> = [
  { label: 'the street line', needle: fixtures.suppressedAddressStreetLine },
  { label: 'the unit number', needle: fixtures.suppressedAddressUnitNumber },
  // Sliced off the last digit: `double precision` round-trips through Postgres and node-postgres
  // as a shortest-representation string, and this scan must not hinge on the final digit agreeing.
  // A prefix this long cannot collide with an unrelated value in this dataset.
  { label: 'the latitude', needle: String(fixtures.suppressedAddressLatitude).slice(0, -1) },
  { label: 'the longitude', needle: String(fixtures.suppressedAddressLongitude).slice(0, -1) },
];

interface ViewRow {
  [column: string]: unknown;
}

let row: ViewRow;

beforeAll(async () => {
  const pool = getPool();
  const result = await pool.query<ViewRow>('SELECT * FROM listing_search_v WHERE id = $1', [
    fixtures.suppressedAddressListingId,
  ]);

  const [only] = result.rows;
  if (result.rows.length !== 1 || !only) {
    throw new Error(
      'listing-search-view.e2e: expected exactly one listing_search_v row for the ' +
        `suppressed-address fixture (${fixtures.suppressedAddressListingId}), got ` +
        `${result.rows.length}. The opt-out is a mask on display, NOT a removal from the market — ` +
        'a suppressed listing must still be searchable and counted. If this row has vanished from ' +
        'the view, that is its own bug and every assertion below would pass vacuously.',
    );
  }
  row = only;
});

afterAll(async () => {
  await closePool();
});

describe('the fixture these guards depend on', () => {
  // ANTI-VACUITY, the same reason tests/support/fixture-ids.ts throws rather than skipping. Every
  // assertion below is "no column contains X". If X were empty, blank, or a value that never
  // existed in the database, they would all pass while testing nothing.
  //
  // The threshold is a floor on NEEDLE LENGTH, and it runs in the opposite direction to the usual
  // anti-vacuity check: a needle that is too SHORT does not make the scan fail, it makes the scan
  // pass for the wrong reason. `String(value).includes('4B')` across ~50 columns of a listing row
  // is a coin flip against ids, remarks and free text, so a short needle reports "no leak" whether
  // or not one exists. Every value in IDENTIFYING_VALUES is therefore held to the same bar, rather
  // than each field getting its own — an earlier version of this test asserted the unit number was
  // merely non-empty AND that every needle exceeded the floor, which contradicted itself and failed
  // the moment it first ran against a real database (the fixture's unit number was `4B`).
  it.each(IDENTIFYING_VALUES)(
    'searches for $label with a needle long enough not to collide by accident',
    ({ needle }) => {
      expect(needle.length).toBeGreaterThan(MIN_NEEDLE_LENGTH);
    },
  );

  it('is the suppressed-address scenario, not some other row', () => {
    // `address_display_allowed` is in FORBIDDEN_COLUMNS for the SERVICE — a handler that reads it
    // is a handler that can re-implement the rule instead of trusting the view. A test asserting
    // the fixture is the scenario it claims to be is the one legitimate reader.
    expect(row.address_display_allowed).toBe(false);
  });

  it('exposes enough columns that the scan below is meaningful', () => {
    expect(Object.keys(row).length).toBeGreaterThan(30);
  });
});

describe('listing_search_v withholds the address from every column, not just the masked ones (#48)', () => {
  it.each(IDENTIFYING_VALUES)(
    'has no column anywhere in the row containing $label',
    ({ needle }) => {
      const leaking = Object.entries(row)
        .filter(([, value]) => value !== null && String(value).includes(needle))
        .map(([column]) => column);

      expect(leaking).toEqual([]);
    },
  );

  it('projects no column named street_line at all', () => {
    // Belt to the scan's braces: the scan catches a leak under ANY column name, this catches the
    // specific regression #48 fixed even if a future fixture's street line changed shape.
    expect(Object.keys(row)).not.toContain('street_line');
  });

  it('masks the address and BOTH coordinates together', () => {
    // Together, not separately: publishing the point re-identifies the address the seller opted
    // out of, so a view that masked one and not the other would defeat the whole opt-out. This is
    // the named-column half of AC 4; the scan above is the whole-row half.
    expect(row.address).toBeNull();
    expect(row.latitude).toBeNull();
    expect(row.longitude).toBeNull();
  });
});
