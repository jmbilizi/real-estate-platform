import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/**
 * Structural guards on `listing_search_v` itself, asserted against the SQL the NEWEST view migration
 * actually emits.
 *
 * WHY THIS EXISTS ALONGSIDE THE e2e SUITE. The behavioural proof that the seller address opt-out
 * holds is `tests/listing-search-view.e2e.spec.ts`, which queries the real view in a real database.
 * But CI never runs `nx e2e` for this project (verified in `.github/workflows/ci.yml`), so an
 * e2e-only guard has ZERO enforcement on the path that actually gates a merge. This file is the
 * half that runs in `nx test`, and therefore in CI, on every change.
 *
 * WHY IT RESOLVES THE MIGRATION DYNAMICALLY. Migration files are immutable once merged, so the view
 * is replaced by appending a new migration rather than editing an old one. A test hard-coded to one
 * filename would keep passing against a superseded definition while the live view drifted — the
 * exact silent failure the immutability rule creates. So this discovers the highest-numbered
 * migration whose `up()` creates `listing_search_v` and asserts against that, meaning a future view
 * migration is automatically the one under test.
 *
 * WHY IT EXECUTES THE MIGRATION RATHER THAN GREPPING THE FILE. Every view migration also carries a
 * `down()` that restores the PREVIOUS definition verbatim — including, deliberately, the unmasked
 * projection this guard forbids. Grepping the file text would read both and could never tell them
 * apart. Running `up()` against a fake `pgm` captures exactly the SQL that will reach Postgres.
 */

interface CapturingMigrationBuilder {
  sql: (statement: string) => void;
}

interface ViewMigration {
  up: (pgm: CapturingMigrationBuilder) => void;
}

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

/** The `CREATE VIEW listing_search_v` statement emitted by the newest migration that creates it. */
function newestCreateViewSql(): string {
  const requireMigration = createRequire(__filename);

  const candidates = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.js'))
    .filter((file) => readFileSync(join(MIGRATIONS_DIR, file), 'utf8').includes('CREATE VIEW'))
    // node-pg-migrate orders by filename and `checkOrder` enforces it, so lexicographic sort over
    // the zero-padded numeric prefix is the same order Postgres will see them applied in.
    .sort();

  const newest = candidates.at(-1);
  if (!newest) {
    throw new Error(
      `listing-search-view.spec: found no migration creating a view in ${MIGRATIONS_DIR}. This ` +
        'guard cannot be allowed to pass vacuously — if the view moved, point this test at it.',
    );
  }

  const statements: string[] = [];
  const migration = requireMigration(join(MIGRATIONS_DIR, newest)) as ViewMigration;
  migration.up({ sql: (statement) => statements.push(statement) });

  const createView = statements.find((statement) =>
    /CREATE VIEW\s+listing_search_v/i.test(statement),
  );
  if (!createView) {
    throw new Error(
      `listing-search-view.spec: ${newest} is the newest migration containing "CREATE VIEW", but ` +
        'its up() emitted no `CREATE VIEW listing_search_v`. Either the view was renamed or a ' +
        'newer migration creates an unrelated view; fix the discovery above rather than deleting ' +
        'this guard.',
    );
  }
  return createView;
}

interface Projection {
  /** The full SQL expression, comments stripped. */
  readonly expression: string;
  /** The column name the view exposes — the `AS` alias, or the trailing identifier. */
  readonly outputName: string;
}

/**
 * Splits on commas at paren depth 0, so `COALESCE(' ' || u.unit_number, '')` stays one projection.
 *
 * `--` line comments are stripped BEFORE this runs: the view's own comments contain commas ("the
 * address, not separately"), which would otherwise split a projection in half. No string literal in
 * this view contains `--`, so stripping by regex is safe here; it would not be in general.
 */
function splitTopLevel(selectList: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let inString = false;
  let current = '';

  for (const char of selectList) {
    if (inString) {
      current += char;
      if (char === "'") {
        inString = false;
      }
      continue;
    }
    if (char === "'") {
      inString = true;
      current += char;
      continue;
    }
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
    } else if (char === ',' && depth === 0) {
      items.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  items.push(current);

  return items.map((item) => item.trim()).filter((item) => item.length > 0);
}

function parseProjections(createViewSql: string): Projection[] {
  const withoutComments = createViewSql.replace(/--[^\n]*/g, '');
  const selectList = /\bSELECT\b([\s\S]*?)\bFROM\s+listings\s+l\b/i.exec(withoutComments)?.[1];
  if (!selectList) {
    throw new Error(
      'listing-search-view.spec: could not locate the SELECT list of listing_search_v. The parser ' +
        'below is the only thing standing between a suppressed address and a projected column, so ' +
        'this throws rather than returning an empty list that would make every assertion pass.',
    );
  }

  return splitTopLevel(selectList).map((expression) => {
    const alias = /\bAS\s+([a-z_][a-z0-9_]*)\s*$/i.exec(expression)?.[1];
    const trailingIdentifier = /([a-z_][a-z0-9_]*)\s*$/i.exec(expression)?.[1];
    const outputName = alias ?? trailingIdentifier;
    if (!outputName) {
      throw new Error(
        `listing-search-view.spec: could not derive an output column name from "${expression}".`,
      );
    }
    return { expression, outputName };
  });
}

const projections = parseProjections(newestCreateViewSql());
const outputNames = projections.map((projection) => projection.outputName);

describe('the parser these guards depend on', () => {
  // ANTI-VACUITY. Every assertion below is of the form "no projection does X". A parser that
  // silently returned nothing — or that split the SELECT list on a comma inside a comment and
  // produced fragments — would make all of them pass while testing nothing. These three assertions
  // are what make a green run mean something.
  it('found a full projection list, not a fragment of one', () => {
    expect(projections.length).toBeGreaterThan(30);
  });

  it('resolved the columns the read model is known to expose', () => {
    expect(outputNames).toEqual(
      expect.arrayContaining([
        'id',
        'title',
        'address',
        'latitude',
        'longitude',
        'city',
        'zip',
        'price',
        'description',
        'listed_by',
        'is_sample',
        'open_house_remarks',
      ]),
    );
  });

  it('derives every output name exactly once, so no projection was silently merged', () => {
    expect(new Set(outputNames).size).toBe(outputNames.length);
  });
});

describe('seller address suppression is structural, not a rule callers must remember (#48)', () => {
  it('projects no street_line column at all', () => {
    // The whole point of #48: the view masked `address` correctly and then handed out the raw line
    // three projections later. `SELECT *`, a logged row, or any caller forwarding the view's
    // columns got the exact address the seller withheld from internet display.
    expect(outputNames).not.toContain('street_line');
  });

  it('gates every projection that touches the street line on address_display_allowed', () => {
    // Stronger and more durable than the name check above: the street line may legitimately be an
    // INPUT (it is what the masked `address` is built from), so the rule is about the predicate,
    // not the identifier. A future `p.street_line AS street` or
    // `p.street_line || ', ' || l.city AS full_address` would fail here even though it projects no
    // column literally named street_line.
    const streetLineProjections = projections.filter((projection) =>
      projection.expression.includes('street_line'),
    );

    expect(streetLineProjections.length).toBeGreaterThan(0);
    for (const projection of streetLineProjections) {
      expect(projection.expression).toMatch(/CASE\s+WHEN[\s\S]*address_display_allowed/i);
    }
  });

  it('masks the coordinates on the same predicate as the address', () => {
    // The point re-identifies the address, so leaking either half defeats the opt-out. Asserted
    // here as well as in the e2e suite because this is the half that runs in CI.
    for (const name of ['address', 'latitude', 'longitude']) {
      const projection = projections.find((candidate) => candidate.outputName === name);
      expect(projection?.expression).toMatch(/CASE\s+WHEN[\s\S]*address_display_allowed/i);
    }
  });
});

describe('the opt-out covers the free-text fields too (#59)', () => {
  /**
   * `title`, `description` and `open_house_remarks` were not conditioned on the opt-out at all —
   * `description` only on `description_moderation`, the other two on nothing. A feed-authored
   * title of the form "142 Oak St — Colonial" on a suppressed listing would both display the
   * withheld street line and restore the confirmation oracle that routing `street=` through the
   * masked `address` column was built to close.
   */
  it.each(['title', 'description', 'open_house_remarks'])(
    'gates %s on address_display_allowed',
    (name) => {
      const projection = projections.find((candidate) => candidate.outputName === name);

      expect(projection).toBeDefined();
      expect(projection?.expression).toMatch(/CASE\s+WHEN[\s\S]*address_display_allowed/i);
    },
  );

  it('keeps the moderation gate on description rather than replacing it', () => {
    // The two withhold copy for unrelated reasons — a seller's address opt-out and a moderation
    // verdict on third-party MLS remarks — so BOTH must hold before a description publishes.
    // Swapping one for the other would silently republish every unmoderated description.
    const description = projections.find((candidate) => candidate.outputName === 'description');

    expect(description?.expression).toMatch(/description_moderation\s*=\s*'approved'/i);
    expect(description?.expression).toMatch(/address_display_allowed/i);
  });

  it('substitutes the title rather than nulling it', () => {
    // The contract declares `title: z.string()` — NOT nullable — so a CASE with no ELSE would fail
    // listingCardSchema.parse() in map-row.ts and turn every suppressed listing into a 500. And a
    // card with no title does not render, which is why AC 2 required this decision to be explicit.
    const title = projections.find((candidate) => candidate.outputName === 'title');

    expect(title?.expression).toMatch(/\bELSE\b/i);
    // The substitute is built only from columns this same row already publishes unmasked, so it
    // discloses nothing new — and never from the street line, which would defeat the whole point.
    expect(title?.expression).not.toContain('street_line');
  });

  it('does NOT suppress the open-house times, only the remarks', () => {
    // A time does not identify an address, and withholding a showing a consumer can attend removes
    // inventory from the market rather than masking it. Asserted so a later "tighten the opt-out"
    // change has to argue with a test instead of silently going further than the rule requires.
    for (const name of ['open_house_starts_at', 'open_house_ends_at']) {
      const projection = projections.find((candidate) => candidate.outputName === name);

      expect(projection).toBeDefined();
      expect(projection?.expression).not.toContain('address_display_allowed');
    }
  });
});
