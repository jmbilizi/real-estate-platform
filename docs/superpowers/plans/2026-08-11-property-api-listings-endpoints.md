# Property API — listings search, detail and freshness (#22) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `property-service`'s first public HTTP surface — the **Property API**
(`GET /listings`, `GET /listings/:id`, `GET /listings/meta`, `GET /openapi.json`) — reading
exclusively through `listing_search_v`, validated by `@cribstop/property-contracts`, and reachable
through the Ocelot gateway with Swagger aggregation.

**Architecture:** Every read is a single SQL statement against `listing_search_v` with **enumerated
columns**. Request parsing, response shapes and the published OpenAPI document all come from
`@cribstop/property-contracts` — the service adds SQL and HTTP, never a second copy of a shape. Two
compliance decisions get exactly one named function each (the sold gate and the address-suppression
boundary) so a future rule change is one edit. The unbounded `has_open_house` column is replaced by
a time-bounded soonest-upcoming-occurrence projection in a new migration, so the "upcoming open
house" rule lives in the view rather than in a handler.

**Tech Stack:** Node 20, Express 4, `pg` 8, Zod 4 (via `@cribstop/property-contracts`),
`node-pg-migrate` 9, Jest + supertest (unit), Jest + axios (e2e), Ocelot + MMLib.SwaggerForOcelot
(gateway).

## Global Constraints

- **Naming (stakeholder correction):** the HTTP surface is the **Property API**, singular.
  `property-service` owns Communities → Properties → Units → Listings; "listings" is one resource
  within it. OpenAPI `info.title`, the gateway `ServiceName`/`SwaggerEndPoints.Key`,
  README/CLAUDE.md prose and commit messages say **Property API**. **URL paths stay `/listings/*`**
  — service name is not resource name.
- **Never `SELECT *`.** Columns are enumerated from one exported list. `listing_search_v` still
  carries the unmasked `street_line` next to the masked `address` (bug **#48**, open, P1);
  enumerating is what keeps that value out of this process. **Do not fix #48 here** and do not let
  its existence surface in a response.
- **No read may bypass `listing_search_v`**, and no view predicate may be restated in a handler's
  WHERE clause.
- **No `COALESCE` / no zero substitution** on `beds`, `baths`, `sqft`. NULL must fail the predicate
  so a land parcel is excluded by `beds>=2`. `minSqft` is **living area**, never lot size.
- **No `COALESCE(neighborhood, city)`** — it would make the neighborhood filter match city names.
- **No field-selection / sparse-fieldset parameter anywhere.** Unknown query parameters are rejected
  **400**. Attribution is non-strippable.
- **No `isSaved` / `isFavorited`** (#23/#25 own saved state) and no per-user ranking signal in any
  sort, now or later.
- **Free-text `query` never searches `description`.** Title/address/city/neighborhood/zip only.
  `street` and `query` match the **masked `address`**, never `street_line`.
- **`listingType=all` = sale + rent, excludes sold.** Sold is opt-in via `listingType=sold`.
- **Every sort is a total order** with an `id` tiebreaker. `recommended` =
  `featured DESC, last_updated DESC, id DESC`, identical for every user.
- Repo law: never raw tool commands (`pnpm run` / `pnpm exec nx` only); never `--no-verify`;
  migration files are immutable once merged (append only, `checkOrder` is on).
- Jest: never put `<rootDir>` inside `testMatch`/`testPathIgnorePatterns` (silently matches nothing
  on Windows).

---

## File Structure

**Contracts (`libs/property-contracts/`)** — one naming change only; the shapes are already correct.

- Modify `src/openapi.ts` — `info.title` → `Cribstop Property API`; `description` gains the
  sale+rent-excludes-sold sentence and the "no field selection" guarantee.
- Modify `src/__snapshots__/openapi.spec.ts.snap` — regenerated.

**Migrations (`apps/services/property-service/migrations/`)**

- Create `1785801600008_add-listing-search-read-indexes.js` — the three indexes the new access
  patterns need.
- Create `1785801600009_replace-listing-search-view-upcoming-open-house.js` — DROP + CREATE
  `listing_search_v`, replacing `has_open_house` with `open_house_starts_at/ends_at/remarks`
  (soonest **upcoming**: non-cancelled, `ends_at > now()`).

**Read model (`apps/services/property-service/src/listings/`)** — one responsibility per file, all
pure except `repository.ts`.

- `columns.ts` — `LISTING_CARD_COLUMNS`, `LISTING_DETAIL_COLUMNS`: the enumerated SELECT lists.
- `sold-gate.ts` — `visibleListingTypesFor()`: the single sold-visibility decision.
- `suppression.ts` — `applyAddressSuppression()`: the single response-boundary suppression.
- `search-query.ts` — `buildSearchQuery()`: validated request → `{ where, params, orderBy }`.
- `map-row.ts` — `toListingCardRow()`, `toListingDetail()`, `toListingsMeta()`: DB row → contract.
- `repository.ts` — `searchListings()`, `findListingById()`, `getListingsMeta()`: the only SQL
  execution.
- `routes.ts` — `createListingsRouter()`: Express wiring, strict parse, status codes, cache headers.

**Service plumbing**

- Modify `src/db/pool.ts` — add a `DATE` type parser (see Task 2).
- Modify `src/app.ts` — mount the router and `GET /openapi.json`.

**Gateway**

- Create `apps/api-gateway/Configuration/Routes/property-service-routes.json`.
- Create `apps/api-gateway/Configuration/Templates/Routes/property-service-routes.json`.

**Tests**

- Unit: `src/listings/*.spec.ts` (pure), `src/app.spec.ts` (supertest + fake pool).
- e2e: `tests/support/fixtures.ts` (guarded compliance fixtures),
  `tests/listings-search.e2e.spec.ts`, `tests/listings-detail.e2e.spec.ts`,
  `tests/listings-meta.e2e.spec.ts`, `tests/openapi.e2e.spec.ts`.

---

### Task 1: Rename the published document to the Property API

**Files:**

- Modify: `libs/property-contracts/src/openapi.ts` (`info` block)
- Modify: `libs/property-contracts/src/__snapshots__/openapi.spec.ts.snap`
- Modify: `libs/property-contracts/README.md`, `libs/property-contracts/CLAUDE.md` (prose only)

**Interfaces:**

- Consumes: nothing.
- Produces: `toOpenApiDocument().info.title === 'Cribstop Property API'` — Task 10's gateway
  `SwaggerEndPoints[].Config[].Name` and Task 9's `/openapi.json` both display it.

- [ ] **Step 1: Write the failing test** — append to `libs/property-contracts/src/openapi.spec.ts`:

```ts
it('publishes the singular Property API title, not a per-resource one', () => {
  // property-service owns Communities → Properties → Units → Listings, so its HTTP surface is the
  // Property API; `listings` is one resource within it (which is why the paths stay /listings/*).
  const document = toOpenApiDocument();
  expect(document.info.title).toBe('Cribstop Property API');
  expect(Object.keys(document.paths)).toContain('/listings');
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm exec nx test @cribstop/property-contracts` Expected: FAIL — received
`'Cribstop Listings API'`.

- [ ] **Step 3: Change `info.title` and tighten the description**

In `libs/property-contracts/src/openapi.ts`, replace the `info` block:

```ts
    info: {
      title: 'Cribstop Property API',
      version: '1.0.0',
      description:
        'The Property API: `property-service` owns Communities → Properties → Units → Listings, ' +
        'and `listings` is one resource within it. Every response carries the full broker/office ' +
        'attribution block (NAR 7.58, PRD §6.2); there is no field-selection parameter and ' +
        'unknown query parameters are rejected, so no caller can omit it. Results are read ' +
        'through a compliance-enforcing view, so seller-suppressed listings are absent rather ' +
        'than redacted. Free-text `query` matches title, address, city, neighborhood and zip — ' +
        'never the description, which is third-party MLS remarks carrying a moderation state ' +
        '(making it searchable would be keyword-based steering, PRD §6.3).',
    },
```

- [ ] **Step 4: Run the tests and refresh the snapshot**

Run: `pnpm exec nx test @cribstop/property-contracts -- -u` Expected: PASS, snapshot updated. Re-run
without `-u` and confirm PASS.

- [ ] **Step 5: Update the prose** — in `libs/property-contracts/README.md` and `CLAUDE.md`, replace
      any "Listings API" phrasing with "Property API", keeping the explicit note that URL paths stay
      `/listings/*`.

- [ ] **Step 6: Commit**

```bash
git add libs/property-contracts
git commit -m "#22 refactor(contracts): publish the singular Property API title"
```

---

### Task 2: Make `close_date` and `baths` survive the wire

**Files:**

- Modify: `apps/services/property-service/src/db/pool.ts`
- Create: `apps/services/property-service/src/db/pool.spec.ts`

**Why:** the contract declares `closeDate` as `z.iso.date()` (`YYYY-MM-DD`) and `baths` as a number.
`pg` returns `numeric` as a **string** (already handled) and `date` as a **JS `Date` at local
midnight** — which serialises to a full ISO datetime _and_ can shift the calendar day by one in any
timezone west of UTC. Both are silent failures.

**Interfaces:**

- Consumes: nothing.
- Produces: `getPool()` rows where `numeric` columns (including `baths_display numeric(4,1)`) are
  `number` and `date` columns (`close_date`) are the raw `'YYYY-MM-DD'` string.

- [ ] **Step 1: Write the failing test** — `apps/services/property-service/src/db/pool.spec.ts`:

```ts
import { types } from 'pg';

// The parsers are registered as a module side effect, so importing is what installs them.
import './pool';

describe('pg type parsers', () => {
  it('parses every numeric width to a number, including baths_display numeric(4,1)', () => {
    const parse = types.getTypeParser(types.builtins.NUMERIC);
    expect(parse('1295000.00')).toBe(1295000);
    expect(parse('2.5')).toBe(2.5);
  });

  it('leaves date as the calendar string the contract publishes, never a Date', () => {
    // close_date is `date`, and the contract declares closeDate as z.iso.date() (YYYY-MM-DD).
    // pg's default parser returns a Date at LOCAL midnight, which JSON-serialises to a datetime
    // and shifts the day west of UTC — a sale would render as having closed the day before.
    const parse = types.getTypeParser(types.builtins.DATE);
    expect(parse('2026-01-05')).toBe('2026-01-05');
  });
});
```

- [ ] **Step 2: Run it and confirm the date case fails**

Run: `pnpm exec nx test property-service` Expected: FAIL — the DATE assertion receives a `Date`.

- [ ] **Step 3: Register the DATE parser** — in `src/db/pool.ts`, directly below the existing
      `NUMERIC` parser:

```ts
/**
 * node-postgres parses DATE into a JS Date at LOCAL midnight. Two things break silently:
 * `JSON.stringify` then emits a full datetime where the contract declares `closeDate` as
 * `z.iso.date()` (YYYY-MM-DD), and in any timezone west of UTC the instant lands on the previous
 * calendar day — a sale would publish as having closed a day earlier than it did.
 *
 * A `date` has no timezone by definition, so the faithful representation is the string Postgres
 * already sent. Returning it unchanged keeps the wire value identical to the stored value.
 */
types.setTypeParser(types.builtins.DATE, (value) => value);
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec nx test property-service` Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/services/property-service/src/db
git commit -m "#22 fix(property-service): read date as a calendar string, not a shifted instant"
```

---

### Task 3: Migration 008 — read indexes for the new access patterns

**Files:**

- Create:
  `apps/services/property-service/migrations/1785801600008_add-listing-search-read-indexes.js`

**Scope discipline:** exactly three indexes, each tied to a query **this ticket introduces**. No
full-text search, no composite filter × sort tuning — those are **#51**, with EXPLAIN evidence.

- [ ] **Step 1: Write the migration**

```js
exports.shorthands = undefined;

/**
 * Read indexes for the Property API's three endpoints (#22). Each one serves an access pattern that
 * did not exist before this ticket. Full-text search over `title`/`address` and composite
 * filter × sort tuning at 100k rows are deliberately NOT here — they are #51, which owes EXPLAIN
 * evidence first. Speculating now would add write cost for a plan nobody has measured.
 *
 * Known and accepted as sequential scans until #51: the zip prefix match and the free-text
 * substring match. Both are `strpos`/`starts_with` over the masked columns, which no btree can
 * serve; making them index-usable means an FTS or trigram design decision, i.e. #51's job.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  // Serves the soonest-UPCOMING-occurrence lateral that migration 009 puts inside
  // listing_search_v: per listing, walk non-cancelled occurrences by start time and stop at the
  // first one still running or to come. Without this, every search row triggers a scan of this
  // table. `ends_at` is included so the `ends_at > now()` bound is an index condition rather than
  // a heap re-check.
  pgm.createIndex('listing_open_houses', ['listing_id', 'starts_at', 'ends_at'], {
    where: 'NOT is_cancelled',
    name: 'idx_listing_open_houses_upcoming',
  });

  // The DEFAULT sort of the DEFAULT search, and the only one that is a full total order by itself:
  // `recommended` is featured DESC, last_updated DESC, id DESC. Partial on the same predicates as
  // the existing idx_listings_live_price so the shape is consistent — this is an index restriction,
  // not a second copy of the view's compliance rules.
  pgm.createIndex(
    'listings',
    [
      { name: 'featured', sort: 'DESC' },
      { name: 'last_updated', sort: 'DESC' },
      { name: 'id', sort: 'DESC' },
    ],
    {
      where: 'deleted_at IS NULL AND internet_display_allowed',
      name: 'idx_listings_recommended',
    },
  );

  // The neighborhood filter is case-insensitive EXACT equality (it is the card title, not a
  // substring search), so the existing GIN trigram index cannot serve it. `properties` already
  // carries the equivalent expression index; `listings` is what the view filters on, because the
  // dwelling/locality snapshot is what keeps search single-table.
  pgm.createIndex('listings', 'lower(neighborhood)', {
    name: 'idx_listings_neighborhood_lower',
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropIndex('listings', 'lower(neighborhood)', { name: 'idx_listings_neighborhood_lower' });
  pgm.dropIndex('listings', [], { name: 'idx_listings_recommended' });
  pgm.dropIndex('listing_open_houses', [], { name: 'idx_listing_open_houses_upcoming' });
};
```

- [ ] **Step 2: Apply it against a real database and confirm the indexes exist**

Run (with `DATABASE_URL` exported — see "Running the stack" in the ticket report):
`pnpm exec nx run property-service:migrate` Expected:
`### MIGRATION 1785801600008_add-listing-search-read-indexes (UP) ###`.

- [ ] **Step 3: Commit**

```bash
git add apps/services/property-service/migrations
git commit -m "#22 feat(property-service): index the Property API read paths"
```

---

### Task 4: Migration 009 — the view projects the soonest UPCOMING open house

**Files:**

- Create:
  `apps/services/property-service/migrations/1785801600009_replace-listing-search-view-upcoming-open-house.js`

**Why a migration:** `1785801600007`'s `has_open_house` is `EXISTS(... WHERE NOT is_cancelled)` with
**no time bound**, so a listing whose only open house was last March matches the filter and lights
the badge. Applied migrations are immutable, so the fix is a new one. `CREATE OR REPLACE VIEW`
cannot drop a column, so this is `DROP VIEW` + `CREATE VIEW`.

**Copy the 007 body verbatim** and change only the open-house projection. Keep `street_line` in the
view — removing it is **#48**, not this ticket.

**Interfaces:**

- Produces: `listing_search_v` columns `open_house_starts_at timestamptz`,
  `open_house_ends_at timestamptz`, `open_house_remarks text` (all NULL together when there is no
  upcoming occurrence); column `has_open_house` no longer exists.

- [ ] **Step 1: Write the migration** — header, then the full `CREATE VIEW` copied from 007 with the
      two edits below:

```js
exports.shorthands = undefined;

/**
 * Replaces `listing_search_v` so the open-house projection is time-bounded and carries the actual
 * occurrence rather than a boolean.
 *
 * 007's `has_open_house` was `EXISTS (... WHERE NOT is_cancelled)` with NO time bound, so a
 * listing whose only open house happened last March still matched — wrong for #22's `openHouse`
 * filter and wrong for `ListingCard`'s truthiness-based badge. UPCOMING means at least one
 * non-cancelled occurrence with `ends_at > now()`, deliberately NOT `starts_at > now()`: an open
 * house running right now is the highest-value match, and excluding it is the more visible bug.
 *
 * Projecting the soonest such occurrence instead of a boolean makes one field serve the filter,
 * the badge and the card copy, which is why the contract has `openHouse: {...} | null` and no
 * `hasOpenHouse`. `now()` inside a view is evaluated per query; it is transaction-scoped, so a
 * search's COUNT and its page (which run in one REPEATABLE READ transaction) always agree.
 *
 * DROP + CREATE rather than CREATE OR REPLACE: replacing cannot remove a column, and
 * `has_open_house` must go — leaving it would leave the wrong rule reachable. Nothing in the
 * codebase selected it (verified by grep), so no caller breaks.
 *
 * `street_line` deliberately stays exposed here: removing it from the view is #48. #22's callers
 * enumerate columns and never select it.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
```

Edit 1 — replace the `has_open_house` select item with:

```sql
      -- The soonest UPCOMING occurrence, or NULLs. See the header for why `ends_at > now()`.
      upcoming_open_house.starts_at                         AS open_house_starts_at,
      upcoming_open_house.ends_at                           AS open_house_ends_at,
      upcoming_open_house.remarks                           AS open_house_remarks,
```

Edit 2 — add this join immediately after `LEFT JOIN units u ON u.id = l.unit_id`:

```sql
    LEFT JOIN LATERAL (
      SELECT oh.starts_at, oh.ends_at, oh.remarks
      FROM listing_open_houses oh
      WHERE oh.listing_id = l.id
        AND NOT oh.is_cancelled
        AND oh.ends_at > now()
      ORDER BY oh.starts_at, oh.id
      LIMIT 1
    ) upcoming_open_house ON true
```

`exports.down` recreates 007's body exactly (boolean `has_open_house`, no lateral).

- [ ] **Step 2: Apply, then assert the view's shape in SQL**

Run: `pnpm exec nx run property-service:migrate` Then verify the new columns exist and the old one
does not — the e2e suite (Task 12) is what locks this in permanently; this step is the immediate
check.

- [ ] **Step 3: Commit**

```bash
git add apps/services/property-service/migrations
git commit -m "#22 fix(property-service): bound the view's open house to upcoming occurrences"
```

---

### Task 5: The enumerated column lists

**Files:**

- Create: `apps/services/property-service/src/listings/columns.ts`
- Create: `apps/services/property-service/src/listings/columns.spec.ts`

**Interfaces:**

- Produces: `LISTING_CARD_COLUMNS: readonly string[]`, `LISTING_CARD_SELECT: string`,
  `LISTING_DETAIL_SELECT: string`, `FORBIDDEN_COLUMNS: readonly string[]`.

- [ ] **Step 1: Write the failing test**

```ts
import { FORBIDDEN_COLUMNS, LISTING_CARD_SELECT, LISTING_DETAIL_SELECT } from './columns';

describe('read-model columns', () => {
  it.each([LISTING_CARD_SELECT, LISTING_DETAIL_SELECT])('never uses a wildcard (%#)', (select) => {
    expect(select).not.toMatch(/\*/);
  });

  it('never selects street_line — the view still carries it unmasked (#48)', () => {
    expect(FORBIDDEN_COLUMNS).toContain('street_line');
    for (const select of [LISTING_CARD_SELECT, LISTING_DETAIL_SELECT]) {
      for (const forbidden of FORBIDDEN_COLUMNS) {
        expect(select).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
      }
    }
  });

  it('keeps description off the card projection and on the detail projection', () => {
    expect(LISTING_CARD_SELECT).not.toMatch(/\bdescription\b/);
    expect(LISTING_DETAIL_SELECT).toMatch(/\bdescription\b/);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails** — `pnpm exec nx test property-service`; module not
      found.

- [ ] **Step 3: Implement `columns.ts`**

```ts
/**
 * The enumerated read-model projections. There is deliberately no `SELECT *` anywhere in this
 * service: `listing_search_v` still carries the unmasked `street_line` beside the masked `address`
 * (#48, open), and enumerating is what keeps that value out of this process entirely rather than
 * relying on a mapper to drop it after it has already been read, logged and buffered.
 */

/** Columns that must never appear in a projection, with the reason each one is barred. */
export const FORBIDDEN_COLUMNS = [
  // #48: the raw street line, unmasked, beside the masked `address`. Reading it at all would put a
  // seller-suppressed address into this process's memory and its query logs.
  'street_line',
  // The view's own compliance predicate inputs. A handler that reads them is a handler that can be
  // tempted to re-implement the rule instead of trusting the view.
  'address_display_allowed',
  'internet_display_allowed',
  'description_moderation',
  'source_status',
] as const;

const CARD_COLUMNS = [
  'id',
  'property_id',
  'unit_id',
  'title',
  'address',
  'city',
  'state',
  'zip',
  'neighborhood',
  'latitude',
  'longitude',
  'price',
  'status',
  'listing_type',
  'source',
  'property_type',
  'beds',
  'baths',
  'sqft',
  'lot_sqft',
  'year_built',
  'amenities',
  'featured',
  'featured_reason',
  'price_reduced',
  'new_construction',
  'is_sample',
  'close_price',
  'close_date',
  'last_updated',
  'listing_agent_name',
  'broker_name',
  'broker_phone',
  'broker_email',
  'office_name',
  'office_broker_lead_phone',
  'office_broker_lead_email',
  'listed_by',
  'open_house_starts_at',
  'open_house_ends_at',
  'open_house_remarks',
] as const;

export const LISTING_CARD_COLUMNS: readonly string[] = CARD_COLUMNS;

const qualify = (columns: readonly string[]) => columns.map((column) => `v.${column}`).join(', ');

export const LISTING_CARD_SELECT = qualify(CARD_COLUMNS);

/**
 * Detail adds `description` — the ONLY place it appears. It is third-party MLS remarks carrying a
 * moderation state (the view withholds unapproved copy), and it is the field with the most Fair
 * Housing steering risk, so it does not belong on the widest and most-cached surface.
 */
export const LISTING_DETAIL_SELECT = `${LISTING_CARD_SELECT}, v.description`;
```

- [ ] **Step 4: Run the tests** — PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/services/property-service/src/listings
git commit -m "#22 feat(property-service): enumerate the read-model columns"
```

---

### Task 6: The sold gate and the address-suppression boundary

**Files:**

- Create: `apps/services/property-service/src/listings/sold-gate.ts` (+ `.spec.ts`)
- Create: `apps/services/property-service/src/listings/suppression.ts` (+ `.spec.ts`)

**Interfaces:**

- Produces:
  - `visibleListingTypesFor(requested: SearchRequest['listingType']): readonly ListingType[]`
  - `applyAddressSuppression(detail: ListingDetail): ListingDetail`

- [ ] **Step 1: Write the failing tests**

`sold-gate.spec.ts`:

```ts
import { visibleListingTypesFor } from './sold-gate';

describe('visibleListingTypesFor', () => {
  it('treats `all` as the shopping surface: sale + rent, never sold', () => {
    expect(visibleListingTypesFor('all')).toEqual(['sale', 'rent']);
  });

  it('returns sold only when sold was asked for explicitly', () => {
    expect(visibleListingTypesFor('sold')).toEqual(['sold']);
    expect(visibleListingTypesFor('sale')).toEqual(['sale']);
    expect(visibleListingTypesFor('rent')).toEqual(['rent']);
  });
});
```

`suppression.spec.ts` (build the fixture with the contract so it cannot drift):

```ts
import { applyAddressSuppression } from './suppression';
import { detailFixture } from './test-fixtures';

describe('applyAddressSuppression', () => {
  it('nulls unit.unitNumber when the view masked the address', () => {
    // The view builds address as `street_line || ' ' || unit_number`, so emitting the unit number
    // next to city/state/zip makes an opted-out condo's address reconstructible.
    const detail = detailFixture({ address: null, unitNumber: '4B' });
    expect(applyAddressSuppression(detail).unit?.unitNumber).toBeNull();
  });

  it('leaves the unit number alone when the address was published', () => {
    const detail = detailFixture({ address: '900 King St 4B', unitNumber: '4B' });
    expect(applyAddressSuppression(detail).unit?.unitNumber).toBe('4B');
  });

  it('is a no-op for a non-subdivided home', () => {
    const detail = detailFixture({ address: null, unitNumber: null, unit: null });
    expect(applyAddressSuppression(detail).unit).toBeNull();
  });
});
```

- [ ] **Step 2: Run and confirm failure.**

- [ ] **Step 3: Implement both**

`sold-gate.ts`:

```ts
import type { SearchRequest } from '@cribstop/property-contracts';

type ListingType = 'sale' | 'rent' | 'sold';

/**
 * THE sold gate. One named function, so tightening solds display is one edit rather than a search
 * for every place `'sold'` appears.
 *
 * Two rules, deliberately in different places:
 *
 *  1. **Publishability** — a Closed listing with no `close_date` is not publishable. That rule is
 *     enforced by `listing_search_v` itself (`consumer_status <> 'Sold' OR close_date IS NOT NULL`)
 *     and is NOT restated here: a second copy of a compliance predicate is a second place for it to
 *     drift. Bright's delay window (#33) is measured from that same close date, so it lands there —
 *     one predicate plus a migration.
 *  2. **Opt-in** — which is this function. `all` is a shopping surface: the default search and the
 *     footer's "Search All" serve a consumer who wants homes they can buy or rent, so sold is
 *     excluded unless asked for by name. Sold is also the most MLS-restricted data class we touch
 *     (per-MLS permission, nondisclosure-jurisdiction price limits, and a Bright delay window we do
 *     not yet hold), and funnelling it through one branch keeps exactly one path to tighten.
 */
export function visibleListingTypesFor(
  requested: SearchRequest['listingType'],
): readonly ListingType[] {
  return requested === 'all' ? ['sale', 'rent'] : [requested];
}
```

`suppression.ts`:

```ts
import type { ListingDetail } from '@cribstop/property-contracts';

/**
 * THE address-suppression boundary for the detail response. One named function at the response
 * edge, for the same reason the sold gate is one function.
 *
 * `listing_search_v` masks the address and the coordinates together, but the unit number lives on
 * `units` and the view builds the address as `street_line || ' ' || unit_number`. So publishing
 * `unit.unitNumber` beside `property.city/state/zip` on a suppressed condo hands back most of the
 * address the seller opted out of. A null address is the signal — not the flag behind it, which
 * this service deliberately never reads (see FORBIDDEN_COLUMNS).
 */
export function applyAddressSuppression(detail: ListingDetail): ListingDetail {
  if (detail.listing.address !== null || detail.unit === null) {
    return detail;
  }
  return { ...detail, unit: { ...detail.unit, unitNumber: null } };
}
```

Also create `src/listings/test-fixtures.ts` building a contract-valid `ListingDetail` via
`listingDetailSchema.parse(...)` so a schema change breaks the fixture rather than hiding behind it.

- [ ] **Step 4: Run the tests** — PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/services/property-service/src/listings
git commit -m "#22 feat(property-service): name the sold gate and the suppression boundary"
```

---

### Task 7: The search query builder

**Files:**

- Create: `apps/services/property-service/src/listings/search-query.ts` (+ `.spec.ts`)

**Interfaces:**

- Produces:
  `buildSearchQuery(request: SearchRequest): { where: string; params: unknown[]; orderBy: string }`
  and `SORT_ORDERS: Record<SearchRequest['sort'], string>`.

**Semantics to encode** — parity with `apps/clients/cribstop/next/src/lib/filters.ts` except where
the AC corrects it (each divergence gets a comment naming the AC):

| Filter            | SQL                                                        |
| ----------------- | ---------------------------------------------------------- |
| `zip`             | `starts_with(v.zip, $n)` (exact **or** prefix, as today)   |
| `street`          | `strpos(lower(v.address), lower($n)) > 0` (masked address) |
| `query`           | OR over `title`, `address`, `city`, `neighborhood`, `zip`  |
| `listingType`     | `v.listing_type = ANY($n)` from `visibleListingTypesFor()` |
| `propertyType`    | `v.property_type = $n` (skipped when `all`)                |
| `minPrice`/`max`  | `v.price >= $n` / `v.price <= $n`                          |
| `beds`/`baths`    | `v.beds >= $n` / `v.baths >= $n` — **no COALESCE**         |
| `minSqft`         | `v.sqft >= $n` (living area)                               |
| `neighborhood`    | `lower(v.neighborhood) = lower($n)` (exact, not substring) |
| `openHouse=true`  | `v.open_house_starts_at IS NOT NULL`                       |
| `newConstruction` | `v.new_construction`                                       |
| `waterfront`      | `'Waterfront' = ANY(v.amenities)`                          |
| `petFriendly`     | `'Pet Friendly' = ANY(v.amenities)`                        |
| `amenities`       | `v.amenities @> $n::text[]` (all must match)               |

Booleans restrict only when `true` (matching `filters.ts`, where `if (filters.openHouse)` is the
guard); `appliedFilters` still echoes `false` so the caller can see it was received and had no
effect, which the OpenAPI description states in words.

**Divergence from `filters.ts`, deliberate:** today `query` is suppressed entirely when `zip` or
`street` is present (`if (filters.query && !filters.zip && !filters.street)`). The AC overrides that
— _"The API applies exactly what it was asked and never silently drops a filter"_ — so all three are
ANDed server-side. A comment must say so, and it must be reported on the ticket.

- [ ] **Step 1: Write the failing tests** — cover, at minimum: `all` excludes sold; `sold` includes
      only sold; every sort ends in an `id` tiebreaker; `recommended` is exactly
      `v.featured DESC, v.last_updated DESC, v.id DESC`; no COALESCE appears anywhere in the emitted
      SQL; `street`/`query` reference `v.address` and never `street_line`; `query` never references
      `description`; `amenities` uses `@>`; `zip`+`query` are ANDed rather than one dropping the
      other; every `$n` placeholder has exactly one param.

```ts
import { searchRequestSchema } from '@cribstop/property-contracts';
import { buildSearchQuery, SORT_ORDERS } from './search-query';

const build = (query: Record<string, unknown> = {}) =>
  buildSearchQuery(searchRequestSchema.parse(query));

describe('buildSearchQuery', () => {
  it('defaults to the shopping surface: sale + rent, no sold', () => {
    const { where, params } = build();
    expect(where).toContain('v.listing_type = ANY(');
    expect(params).toContainEqual(['sale', 'rent']);
  });

  it('gives every sort an id tiebreaker so paging is a total order', () => {
    for (const order of Object.values(SORT_ORDERS)) {
      expect(order).toMatch(/v\.id (ASC|DESC)$/);
    }
  });

  it('specifies recommended exactly, with no per-user signal', () => {
    expect(SORT_ORDERS.recommended).toBe('v.featured DESC, v.last_updated DESC, v.id DESC');
  });

  it('never substitutes zero for a land parcel’s null beds/baths/sqft', () => {
    const { where } = build({ beds: '2', baths: '1.5', minSqft: '900' });
    expect(where).not.toMatch(/coalesce/i);
    expect(where).toContain('v.beds >= ');
  });

  it('filters street and free-text against the masked address, never street_line', () => {
    const { where } = build({ street: 'King', query: 'King' });
    expect(where).toContain('lower(v.address)');
    expect(where).not.toContain('street_line');
  });

  it('never searches the description', () => {
    expect(build({ query: 'quiet block' }).where).not.toContain('description');
  });

  it('ANDs query with zip instead of dropping one of them', () => {
    // filters.ts suppresses `query` when zip/street is set; the AC requires the API to apply
    // exactly what it was asked.
    const { where } = build({ zip: '22314', query: 'King' });
    expect(where).toContain('starts_with(v.zip');
    expect(where).toContain('lower(v.title)');
  });

  it('requires every requested amenity, not any', () => {
    const { where, params } = build({ amenities: 'Pool,Garage' });
    expect(where).toContain('v.amenities @> ');
    expect(params).toContainEqual(['Pool', 'Garage']);
  });

  it('binds exactly one parameter per placeholder', () => {
    const { where, params } = build({ zip: '22314', beds: '3', amenities: 'Pool' });
    const placeholders = new Set(where.match(/\$\d+/g) ?? []);
    expect(placeholders.size).toBe(params.length);
  });
});
```

- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Implement `search-query.ts`** — a `params` array with a `bind()` helper returning
      `$${params.length}`, one `if` per filter in the table above, `where` joined with `\n  AND `,
      defaulting to `'TRUE'` when no filter applies.

- [ ] **Step 4: Run the tests** — PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/services/property-service/src/listings
git commit -m "#22 feat(property-service): build listings search SQL with total-order sorts"
```

---

### Task 8: Row mappers and the repository

**Files:**

- Create: `apps/services/property-service/src/listings/map-row.ts` (+ `.spec.ts`)
- Create: `apps/services/property-service/src/listings/repository.ts` (+ `.spec.ts`)

**Interfaces:**

- Produces:
  - `toListingCardRow(row): ListingCardRow`, `toListingDetail(row): ListingDetail`,
    `toListingsMeta(row): ListingsMeta`
  - `searchListings(db, request): Promise<ListingsEnvelope>`,
    `findListingById(db, id): Promise<ListingDetail | null>`,
    `getListingsMeta(db): Promise<ListingsMeta>`
  - `db` is the narrow `Queryable`-style seam (`{ query }` plus `connect` for the transaction) so
    unit tests pass a fake and never a socket — same seam style as `src/db/write.ts`.

**Mapper rules:** `sponsored = row.featured_reason === 'paid'`; timestamptz → `.toISOString()`;
`open_house_*` collapse into `openHouse: {...} | null`; `amenities` passes through; every mapper
result is `...Schema.parse(...)`d so a drift between SQL and contract fails loudly at the boundary
instead of shipping a malformed payload.

**Repository rules:**

- Search runs **two statements in one `REPEATABLE READ READ ONLY` transaction** — `COUNT(*)` then
  the page. `now()` is transaction-scoped, so the open-house time bound is identical for both, and
  the snapshot makes `total` and the page mutually consistent. A page past the end therefore still
  returns the correct `total` with `results: []`.
- Detail is **one statement** whose `FROM` is `listing_search_v` — `JOIN properties`,
  `LEFT JOIN units` and two `LEFT JOIN LATERAL` json aggregations (media by `sort_order`; upcoming
  open houses by `starts_at`) hang off it, so the view remains the sole row-visibility gate and an
  excluded listing is never joined to anything.
- `getListingsMeta` is `MAX(last_updated)`, `COUNT(*)`, `array_agg(DISTINCT source ORDER BY source)`
  over the view — null max maps to `null`, null agg maps to `[]`.

- [ ] **Step 1: Write the failing tests** — mappers: `sponsored` derives from `featured_reason`;
      attribution keys are all present (iterate `ATTRIBUTION_KEYS` from the contract); `closeDate`
      stays `YYYY-MM-DD`; open-house columns collapse correctly. Repository (fake `db`): the emitted
      SQL's `FROM` is `listing_search_v` and contains no wildcard; search issues
      `BEGIN`/`SET TRANSACTION`/count/page/`COMMIT`; page-past-end yields `results: []` with the
      count's `total`; `pageCount` is `Math.ceil(total / pageSize)`; `appliedFilters` echoes the
      parsed request.
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Implement both.**
- [ ] **Step 4: Run the tests** — PASS.
- [ ] **Step 5: Commit**

```bash
git add apps/services/property-service/src/listings
git commit -m "#22 feat(property-service): read listings through the view with an exact total"
```

---

### Task 9: The HTTP surface — routes, strict parsing, cache headers, `/openapi.json`

**Files:**

- Create: `apps/services/property-service/src/listings/routes.ts`
- Modify: `apps/services/property-service/src/app.ts`
- Modify: `apps/services/property-service/src/app.spec.ts`

**Interfaces:**

- Produces: `createListingsRouter(db)`; `createApp({ db })` with `db` defaulting to `getPool()` so
  tests inject a fake and `main.ts` needs no change.

**Rules:**

- Route order: `GET /listings`, then **`GET /listings/meta`**, then
  `GET /listings/:id(<uuid regex>)`. The literal must be registered before the parameterised route
  **and** the parameterised route constrained to a UUID — belt and braces, because Ocelot has the
  same ordering hazard.
- Anything under `/listings/` that is not a UUID falls through to a handler returning **404 with
  `NOT_FOUND_BODY`** — byte-identical to an unknown id, a soft-deleted id and a suppressed id. Never
  403, never a distinct message.
- Strict parse: `searchRequestSchema.safeParse(req.query)`; on failure **400** with
  `{ error: { code: 'invalid_request', message } }`. The message must name the offending parameter
  but must not echo unbounded caller input.
- `Cache-Control`: `/listings` and `/listings/:id` → `public, max-age=60` (they embed the
  time-relative upcoming open house; never `no-store` — these payloads carry no PII and must not
  start to). `/listings/meta` → `public, max-age=60, s-maxage=300, stale-while-revalidate=60`.
- `GET /openapi.json` serves `toOpenApiDocument()` (computed once at module load — it is pure) so
  MMLib.SwaggerForOcelot aggregates a document that cannot drift from the request parser.

- [ ] **Step 1: Write the failing tests** in `src/app.spec.ts` with supertest and a fake `db`:
      `/listings/meta` is not captured by `/listings/:id`; `?bed=3` → 400 (`invalid_request`);
      `?fields=id` → 400; a non-UUID id → 404 with exactly `NOT_FOUND_BODY`; an unknown UUID → the
      identical body and status; cache headers on all three; `/openapi.json` returns
      `info.title === 'Cribstop Property API'` and the three paths; every row of a list response
      carries all `ATTRIBUTION_KEYS`.
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Implement `routes.ts` and wire `app.ts`.**
- [ ] **Step 4: Run tests, lint and type-check**

```
pnpm exec nx test property-service
pnpm exec nx lint property-service
pnpm exec nx type-check property-service
```

- [ ] **Step 5: Commit**

```bash
git add apps/services/property-service/src
git commit -m "#22 feat(property-service): serve the Property API and its OpenAPI document"
```

---

### Task 10: Gateway route registration and Swagger aggregation

**Files:**

- Create: `apps/api-gateway/Configuration/Routes/property-service-routes.json`
- Create: `apps/api-gateway/Configuration/Templates/Routes/property-service-routes.json`

**Facts established by recon — do not re-derive:**

- `JsonMerger` reads every `*.json` in `Configuration/Routes/`, requires a **boolean**
  `"Active": true` (a string silently skips the whole file), and **stamps `SwaggerKey` onto every
  route from the file's top-level `ServiceName`** — never hand-write `SwaggerKey`.
- `SwaggerEndPoints` lives **in the route file**, not `Ocelot.Settings.json` (which holds an empty
  array the merger unions into).
- Ocelot `Priority`: higher wins. Shipped files give literal routes `1` and the catch-all `0`.
- Downstream host is the short ClusterIP service name: `property-service-svc:3002`.
- Upstream paths are **bare** (`/account/*`, `/inference/*`) in the real files; only the unused
  templates carry `/gateway` (that is **#49**). So: `/listings/*`, no `/gateway`.

- [ ] **Step 1: Write the route file**

`ServiceName` and `SwaggerEndPoints[].Key` are both `"Property"`; the display name is
`"Property API"`. Routes, in priority order:

| Upstream         | Methods | Downstream       | Priority |
| ---------------- | ------- | ---------------- | -------- |
| `/listings/meta` | GET     | `/listings/meta` | 2        |
| `/listings`      | GET     | `/listings`      | 1        |
| `/listings/{id}` | GET     | `/listings/{id}` | 0        |

`/listings/meta` gets the highest priority so `/listings/{id}` cannot capture it; `{id}` gets the
lowest for the same reason. `DownstreamScheme: "http"`, `TransformByOcelotConfig: false` (upstream
and downstream templates are byte-identical, so there is nothing to transform — same as
account-service), and `SwaggerEndPoints[].Config[].Url` is
`http://property-service-svc:3002/openapi.json`.

`RateLimitOptions` mirrors the shipped account-service shape. These are the platform's **first
public unauthenticated** endpoints and one of them runs an exact `COUNT(*)`, so shipping them with
no limit at all would be a regression against the pattern. Circuit breaking, timeouts and real
tuning (`QoSOptions`) remain **#52**.

- [ ] **Step 2: Add the matching template copy** under `Configuration/Templates/Routes/`, following
      the shipped template convention (that convention's `/gateway` prefix is #49's to correct — the
      template must match its siblings, not the active file).

- [ ] **Step 3: Validate the JSON parses and the gateway builds**

```
pnpm exec nx build api-gateway
pnpm exec nx test api-gateway
```

- [ ] **Step 4: Commit**

```bash
git add apps/api-gateway/Configuration
git commit -m "#22 feat(api-gateway): route the Property API and aggregate its OpenAPI document"
```

---

### Task 11: Guarded e2e compliance fixtures

**Files:**

- Create: `apps/services/property-service/tests/support/fixtures.ts`

**Why this exists:** the seed dataset has **zero** suppressed addresses, zero suppressed listings,
zero unapproved descriptions, zero non-consumer statuses, zero `Land` rows and zero NULL
beds/baths/sqft — so every compliance assertion the repo has today is **vacuously true**.

**Three independent guards, because one is a single point of failure:**

1. **Location.** Fixtures live in `tests/`, which `jest.config.ts` ignores, webpack does not bundle,
   and `skaffold.yaml` excludes from the image context. They cannot ship.
2. **Opt-in.** `loadComplianceFixtures()` throws unless `PROPERTY_SERVICE_E2E_FIXTURES === '1'`.
3. **Shape.** Every fixture row is `is_sample = true` with a `(Sample)`-suffixed title and an
   `internal` source, and every property uses a reserved-for-documentation street so a leaked row is
   self-labelling rather than mistakable for inventory.

**Writer discipline:** fixtures write `listings` **only** through `upsertListing()` from
`src/db/write.ts` — that module is the only writer, and `seed.spec.ts` asserts it. Properties/units
go through `getOrCreateProperty()` / `getOrCreateUnit()`.

**Fixtures required by the AC:**

| Fixture                 | Shape                                                             |
| ----------------------- | ----------------------------------------------------------------- |
| suppressed address      | `address_display_allowed = false` → address/lat/long all null     |
| suppressed listing      | `internet_display_allowed = false` → absent + 404 on detail       |
| unapproved description  | `description_moderation = 'suppressed'` → withheld, never matched |
| non-consumer statuses   | `Withdrawn`, `Expired`, `Canceled`, `Hold` → absent everywhere    |
| land parcel             | `Land`, NULL beds/baths/sqft, non-null `lot_sqft`                 |
| sold with close date    | publishable, carries `closePrice`/`closeDate`                     |
| sold without close date | never publishable                                                 |
| subdivided condo        | suppressed address **and** a unit number → suppression target     |
| sample row              | `is_sample` true on both shapes                                   |

- [ ] **Step 1: Implement `loadComplianceFixtures(pool)` / `removeComplianceFixtures(pool)`,
      transactional, idempotent, returning the created ids by name.**
- [ ] **Step 2: Write a unit test for the guard itself** (`fixtures.guard.spec.ts` under `src/` is
      wrong — keep it in `tests/` and assert the throw with the env var unset).
- [ ] **Step 3: Commit**

```bash
git add apps/services/property-service/tests
git commit -m "#22 test(property-service): add guarded compliance fixtures"
```

---

### Task 12: The e2e suite

**Files:**

- Create: `tests/listings-search.e2e.spec.ts`, `tests/listings-detail.e2e.spec.ts`,
  `tests/listings-meta.e2e.spec.ts`, `tests/openapi.e2e.spec.ts`
- Modify: `tests/support/global-setup.ts` (load fixtures), `global-teardown.ts` (remove them)

**Assertions — the full AC list:**

- Suppressed address: present in results and in `total`, `address`/`latitude`/`longitude` all null;
  `unit.unitNumber` null on detail; **not** matched by a `street` filter on its real street line.
- Suppressed listing: absent from search **and** `404` on detail with a body byte-identical to an
  unknown id's.
- Unapproved description: `description` null on detail, and never matched by `query`.
- Non-consumer statuses: absent from every endpoint and from `total`.
- Land parcel: excluded by `beds>=1`/`baths>=1`/`minSqft`; present with `lotSqft` and
  `propertyType: 'Land'` when those filters are absent.
- Sold: `listingType=all` excludes both sold rows; `listingType=sold` returns only the one with a
  close date, carrying `closePrice` **and** `closeDate` alongside `price`.
- `openHouse=true` matches an occurrence **in progress right now** (`starts_at` past, `ends_at`
  future) and does **not** match a past-only or cancelled one.
- Pagination: `total` is exact and equal across pages; page 2 shares no id with page 1 for **every**
  sort value; a page past the end is `200` with `results: []` and the correct `total`.
- Strict parse: `?bed=3` → 400; `?fields=id` → 400; `?pageSize=101` → 400.
- Attribution: every row of every response carries all `ATTRIBUTION_KEYS` with non-empty
  `brokerName`/`officeName`/`listedBy`, under every filter combination tried.
- `sponsored`: no fixture or seeded row has `featured_reason = 'paid'` (asserted directly against
  the view) — the label cannot be rendered until #24.
- `/listings/meta`: `dataUpdatedAt` equals `MAX(last_updated)` over the view, is never in the
  future, is unchanged by a local `UPDATE` that moves `updated_at`; `sources` contains only values
  actually present; `listingCount` matches the unfiltered `total`.
- Response validation: every payload is `parse`d with its contract schema, so the wire shape is
  asserted by the contract rather than by hand-written key lists.
- Cache headers on all three endpoints.

- [ ] **Step 1: Write the suite.**
- [ ] **Step 2: Run it against a live service and database**

```
pnpm exec nx e2e property-service
```

- [ ] **Step 3: Commit**

```bash
git add apps/services/property-service/tests
git commit -m "#22 test(property-service): cover the Property API's compliance payload end to end"
```

---

### Task 13: Documentation

**Files:**

- Modify: `apps/services/property-service/README.md`, `apps/services/property-service/CLAUDE.md`
- Modify: `apps/api-gateway/Configuration/Routes/README.md` (its "Current State" claims the folder
  is empty, which was already false and is now more so)

- [ ] **Step 1:** Replace property-service's "No public REST API beyond `GET /health`" rule with the
      Property API surface: the three endpoints, `/openapi.json`, the naming rule (Property API,
      `/listings/*` paths), the no-`SELECT *`/#48 rule, the two named compliance functions, the
      `REPEATABLE READ` rationale, the DATE parser trap, and the fixtures' three guards.
- [ ] **Step 2:** Commit.

```bash
git add apps/services/property-service apps/api-gateway/Configuration/Routes/README.md
git commit -m "#22 docs: document the Property API surface and its read-model rules"
```

---

### Task 14: Deploy and verify (the ticket is not done until this passes)

- [ ] **Step 1:** `pnpm run infra:local:cluster:setup` (if absent) and
      `pnpm run infra:local:registry:ensure`.
- [ ] **Step 2:** `pnpm run skaffold:services:deploy` — capture the **exit code**, not pod status.
      `1/8 deployment(s) failed` is a failure even if the pod later self-heals.
- [ ] **Step 3:** Confirm the `migrate` initContainer completed and both new migrations applied.
- [ ] **Step 4:** Through the **gateway** on `localhost:8080`: `GET /listings`,
      `GET /listings/meta`, `GET /listings/<id>`, an unknown id (404), a bad parameter (400), and
      the aggregated Swagger document showing the Property API.
- [ ] **Step 5:** `pnpm run pre-push`, then `pnpm run infra:validate:dev`.
- [ ] **Step 6:** Shut down every background process (`taskkill //F //IM kubectl.exe`, likewise
      `skaffold.exe`/`node.exe`) and confirm none survive.

---

## Self-Review

**Spec coverage:** read model/no bypass → Tasks 4,5,7,8; `GET /listings` filters, envelope,
`appliedFilters`, total orders, open house, land, `all`-excludes-sold, sold gate, close price,
description non-search, masked-address filtering → Tasks 6,7,8,12; detail nested shape,
description-only-here, identical 404, unit-number suppression → Tasks 6,8,9,12; `/listings/meta` →
Tasks 8,9,12; non-strippable payload, `sponsored`, strict parse, no `isSaved` → Tasks 5,8,9,12;
caching → Task 9; indexes → Task 3; gateway + OpenAPI → Tasks 1,9,10; fixtures and tests → Tasks
11,12.

**Open conflict to report on the ticket, not silently resolved:** `filters.ts` suppresses `query`
when `zip`/`street` is present; the AC forbids silently dropping a filter. Plan implements the AC
(AND all three) and reports the divergence.

**Migration numbering:** the AC names `1785801600008_add-listing-search-read-indexes.js`, which this
plan honours exactly; the view replacement the AC also requires ("replacing it needs a new
migration") therefore takes `009`. Order is immaterial — Postgres does not care whether the indexes
or the view are created first.
