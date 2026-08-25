# Property Service (property-service)

Node.js + Express + PostgreSQL service owning the **Communities → Properties → Units → Listings**
hierarchy (PRD §3), the consumer listing model (§3.1), and eventually Bright MLS ingestion and
property-relationship claims (§3.2). Nx project name: **`property-service`**. Port **3002** (PRD
§2.1). The first Node service in this repo that talks to Postgres.

## Why Node, and what that commits us to

Re-decided on merits before #22 froze the API contract, not inherited from PRD §2.2. The deciding
reason is that **this service's primary customer is a TypeScript app**: it exists to serve the
Next.js client, and the dominant failure mode here is contract drift, not throughput — hence the
repo's `contract-sync-reviewer` agent and PRD §17 making TypeScript canonical with ".NET contracts
mirror them where needed". One compiler-enforced definition of the listing shape matters most
exactly where the data carries Fair Housing and NAR 7.58 obligations. Everything expensive is
delegated to Postgres, so runtime performance was never the variable.

The strongest counter-argument was .NET's `$metadata`-driven OData tooling for RESO ingestion. It
does not hold: RESO Web API replication is paginated GETs with
`$filter=ModificationTimestamp gt <checkpoint>`, `$select` and `$skiptoken`. A generated typed
client is a convenience, not a requirement.

**The split that does matter is by workload, not language.** MLS ingestion is throughput-bound and
scheduled and must not compete with request-serving CPU, so it becomes a separate process — but
start it as another Nx target _in this project_, still Node, so it reuses `src/db/write.ts`
directly.

> **An ingestion worker in another language must never write to `property_db` directly.** It would
> have to re-implement the snapshot resolution rule (`COALESCE(unit.x, property.x)`, terminal
> freeze, audited corrections) and would drift — the precise failure `write.ts` exists to prevent.
> The language-agnostic seam is the Redis Streams bus (PRD §2.3): the worker publishes normalised
> listing events in whatever language suits, and this service stays the only writer.

Consequence to budget in #22: **Express generates no OpenAPI**, while the gateway's
`MMLib.SwaggerForOcelot` fetches a spec URL per service (account-service serves `/openapi/v1.json`,
inference serves `/openapi.json`). Do not hand-write one — define the request/response schemas once
in a shared `libs/` package and derive runtime validation, the client's types, and the OpenAPI
document from it. A hand-written spec is a second source of truth that silently drifts from the
routes.

## The wire contract lives in `libs/property-contracts`

`libs/property-contracts` (`@cribstop/property-contracts`) is the **only** definition of the
request/response shapes described above — never restate a field list here even for a single route;
import the types and schemas instead. `#22` is where this service starts actually consuming them.

The Dockerfile must keep its `libs/property-contracts` `COPY` lines (both the `package.json`-only
copy in the `deps` stage and the full-source copy in `builder`) or the image goes stale silently the
next time the contract changes — `tools/ci/affected-images.js` **narrows** the Nx-affected CI
image-rebuild matrix using those `COPY` sources (it never adds a project Nx's own affected graph
didn't already call for, and fails open when it can't resolve a Dockerfile).

**`libs/property-contracts`'s Nx project name must stay identical to its npm package name**
(`@cribstop/property-contracts`). Nx 22.0.1's `@nx/js:prune-lockfile` looks a workspace dependency
up by **package** name in a map keyed by **project** name; a mismatch makes the lookup miss and
silently drops that package's own dependencies (`zod`) from this service's pruned `pnpm-lock.yaml`,
breaking the `--frozen-lockfile` production install with `ERR_PNPM_LOCKFILE_MISSING_DEPENDENCY`.
`#47` originally worked around this with a `pnpm install --lockfile-only` pass before the frozen
install; that workaround is gone now that the names match — see `libs/property-contracts/AGENTS.md`
(ticket #55 tracks the underlying upstream defects). If a future rename ever lets the two names
diverge again, expect this exact failure to come back.

## Commands

```bash
pnpm exec nx serve property-service        # Run locally (port 3002)
pnpm exec nx test property-service         # Unit tests — no database required
pnpm exec nx e2e property-service          # Boots the service, then hits it over HTTP
pnpm exec nx lint property-service         # Also: type-check, build
pnpm exec nx run property-service:migrate       # Apply migrations (needs DATABASE_URL)
pnpm exec nx run property-service:migrate-down  # Roll back the last migration
pnpm exec nx run property-service:seed          # Load the sample dataset into $DATABASE_URL
pnpm run skaffold:services                 # Deploy into the local cluster (seeds itself — see below)
```

## Data model — durable home vs. listing episode

`properties`/`units` hold what does **not** change when a listing does; `listings` hold one offer. A
property may have zero or many listings across the years, and is fully meaningful with none — that
is what PRD §3.2 claims and §4.6 service history attach to.

- **`properties`** — site facts (parsed address, geo, lot, year built, neighborhood, property type)
  **plus the dwelling facts (beds, baths, living area) when the property is not subdivided.**
- **`units`** — **optional** (PRD §3). Present only for a genuinely subdivided building, carrying
  that unit's dwelling facts. A single-family home or townhome has **zero** unit rows; there is no
  synthetic "whole property" unit. `listings.unit_id IS NULL` means "the offer is the whole
  property", never "unknown". Resolution is exactly one level deep: `COALESCE(unit.x, property.x)`.
- **`listings`** — offer facts plus a **one-way snapshot** of the resolved dwelling facts, so search
  is a single-table indexed query and a closed listing keeps rendering as it was advertised.

**`src/db/write.ts` is the only module that writes `listings`.** The snapshot cannot be constrained
in the database (for a terminal listing it is _deliberately_ unequal to the durable rows), so the
containment is structural, and `seed.spec.ts` asserts no other module issues INSERT/UPDATE on the
table. `upsertListing()` resolves the snapshot itself and ignores whatever the caller passed for
those columns; it refuses to re-snapshot a terminal listing, and `applyTerminalCorrection()` is the
audited path for correcting one.

`properties.address_key` (from `src/seed/address.ts`) is the deduplication identity. Never insert a
property blindly — use `getOrCreateProperty()`, or one physical building becomes two rows and two
accounts can each hold an approved `owner` claim on it.

**Fair Housing: never add these columns** to properties/units/listings — no `attributes jsonb` bag
(a RESO mapping exposes `HighSchoolDistrict`, `ElementarySchool` and similar, so an open bag
persists steering-adjacent fields with no migration to review), no `keywords`/`tags`/`features`
free-text array, no `school_rating`/`crime_index`/`safety_score`/`desirability`/demographic columns,
and no audience/segment column on anything holding consumer-visible copy. `amenities` is a closed
15-value set enforced by a DB CHECK as well as `validateAmenities()`.

`listing_search_v` **enforces** the display rules rather than carrying flags for callers to
remember. When `address_display_allowed` is false it masks, on that one predicate: the address, the
coordinates (the point re-identifies the address), the **description**, the **open-house remarks**,
and it substitutes a neutral derived **title** (#59) — while projecting **no** unmasked street line
beside any of them (#48). It also withholds unmoderated descriptions, excludes statuses with no
`consumer_status`, and gates solds on `close_date`.

**The free-text fields are the half that gets forgotten.** A feed-authored title like
`"142 Oak St — Colonial"` publishes the withheld street line _and_ — because `title` is a free-text
`query` target — restores the confirmation oracle that routing `street=` through the masked
`address` was built to close. `title` is **substituted, not nulled**: the contract declares
`title: z.string()` (non-nullable), so nulling it 500s at the mapper's `.parse()` and a card with no
title does not render. The substitute is `property_type || ' in ' || city || ', ' || state` — only
columns the same row already publishes unmasked. Open-house **times** are deliberately not masked: a
time does not identify an address, and withholding a showing removes inventory from the market
rather than masking it.

## Database

Owns `property_db`, which the Postgres StatefulSet provisions along with `property_service_db_user`
and the `uuid-ossp` / `postgis` / `pg_trgm` / `btree_gist` / `vector` extensions — see
`infra/k8s/base/configmaps/postgres.configmap.yaml`. This service does **not** create the database;
it only owns the schema inside it.

Postgres is **18** (`infra/docker/postgres/Dockerfile` — PostGIS + pgvector), so `uuidv7()` is
native and every primary key uses it rather than random `uuid_generate_v4()`.

- **Local**: copy `.env.example` to `.env` and set `DATABASE_URL`. Migrations run via the `migrate`
  target, which uses `--envPath .env`. This is the workstation path for `migrate`/`migrate-down` and
  for the e2e compliance fixtures — it is **not** how you get sample data into a cluster (see
  below).
- **In-cluster**: `DATABASE_URL` is assembled in the Deployment from `postgres-svc` plus the
  `PROPERTY_SERVICE_DB_USER_PASSWORD` key of `postgres-secret`. Migrations run in a **`migrate`
  initContainer** using the same image, invoking `node-pg-migrate` directly — deliberately with no
  `--envPath`, because containers get env vars, not a `.env` file.
- Migrations are plain CommonJS in `migrations/` and are **not** part of the webpack bundle, so the
  Dockerfile copies that directory into the runtime image explicitly. If you move it, the
  initContainer silently has nothing to apply.

### Sample data: seeded in-cluster, not from a workstation (#111)

**`pnpm run skaffold:services` brings up a populated `property_db` on its own.** There is no `.env`,
no `kubectl port-forward` and no credential to lift out of `postgres.secret.yaml` — the `migrate`
initContainer already holds the host, the user and the secret, so it seeds itself immediately after
migrations by spawning `seed-on-start.js` (bundled next to `main.js` by `webpack.config.js` →
`additionalEntryPoints`). Nothing runs in `src/main.ts`: a seed there would add a database
round-trip before `listen()` and would race across replicas.

Three conditions, all required, implemented in `src/seed/seed-on-start.ts`:

1. `PROPERTY_SERVICE_SEED_ON_START` is exactly `'1'`, set **only** in `infra/k8s/podman/local` and
   `infra/k8s/hetzner/dev`. `hetzner/test` and `hetzner/prod` never set it.
2. `NODE_ENV` is not `production` — independent of the flag, mirroring `tests/support/fixtures.ts`.
   Those two overlays therefore also set `NODE_ENV=development` **on the initContainer**, because
   the runtime image bakes `NODE_ENV=production` and the api container's override does not reach an
   initContainer.
3. `listings` is empty. Emptiness is never the sole trigger — a fresh production `property_db` is
   empty by definition, and emptiness alone would self-populate it with fabricated inventory.

Re-running is a no-op: a populated table short-circuits before any write, and `runSeed()` is
idempotent on `address_key` regardless. The `seed` Nx target still exists for loading the dataset
into an arbitrary database you have pointed `DATABASE_URL` at — it is no longer the way to get local
data.

### Migration rules (each of these fails silently or confusingly if ignored)

- **These files are immutable once merged.** `pgmigrations` keys applied migrations by **filename**,
  and there is no checksum check, so editing an applied migration diverges a fresh database from a
  deployed one with no error. New migrations only ever append — `checkOrder` is on, so a migration
  hand-numbered _below_ an already-applied one throws forever.
- **Recovery after an in-place edit is to drop and recreate `property_db`** as `postgres_sa`, then
  let the next deploy's `migrate` initContainer rebuild it. That is the minimum blast radius, and it
  is the same operation a persistent dev/test environment needs — so it is the one worth rehearsing
  locally. The extensions come back on their own: the postStart reconcile script recreates the full
  set. What does **not** work: `infra:local:cluster:reset:disk` leaves the PVC in place (so the old
  schema survives), and `migrate-down` fails on the _first_ call once any filename has changed
  (`Definitions of migrations ... have been deleted`). Deleting and recreating the whole kind
  cluster also works but is a bigger hammer than the situation needs, and it rehearses a path CI/CD
  never takes — CI/CD always rolls out onto persistent volumes.
- **Only TRUSTED extensions may be created from a migration.** Verified on this instance: `pg_trgm`
  is trusted, `postgis` and `vector` are not. `property_service_db_user` owns the database but is
  not a superuser, so attempting the untrusted ones fails with 42501 — they are provisioned as
  `postgres_sa` in the configmap, in `sync-passwords.sh` (which runs on **every** boot) rather than
  `init-databases.sh` (which runs only when PGDATA is empty).
- **Generated columns must use the `expressionGenerated` column option.** On PostgreSQL 18 a bare
  `GENERATED ALWAYS AS (...)` defaults to **VIRTUAL**, and virtual columns cannot be indexed;
  `expressionGenerated` emits `STORED`. Never hand-write one via `pgm.sql`.
- **Create `set_updated_at()` exactly once** (migration `000`). `pgm.createTrigger()` emits a
  `CREATE FUNCTION` every time it is handed a body, so defining it per table fails on the first run
  — every other table passes `{ function: 'set_updated_at' }` and no definition. The trigger covers
  `updated_at` only: `listings.last_updated` is MLS feed freshness and must never be advanced by a
  local write.
- **Always pass an explicit `{ name: 'idx_...' }`** for any expression, opclass, or partial index,
  or node-pg-migrate generates identifiers like `"properties_(lower(neighborhood))_index"`.
- `NULLS NOT DISTINCT` is only expressible via
  `pgm.createIndex(t, cols, { unique: true, nulls: 'not distinct', name })`, never `addConstraint`.
- **Keep the writer's SQL fully parameterised.** A literal such as `now()` inside a `VALUES` list
  consumes no placeholder and silently shifts every later column out of step with its bound value —
  give the column a `default` instead and omit it from the INSERT.
- `numeric` is returned by node-postgres as a **string**; `src/db/pool.ts` registers a parser so
  prices are numbers and do not sort lexicographically. Do not widen that parser to a column where
  cents must round-trip exactly.

## Structure Notes

- `src/app.ts` builds the Express app; `src/main.ts` owns the listener. The split lets tests
  exercise routes with no socket and no database.
- `src/db/pool.ts` — lazily-created `pg` pool, configured only from `DATABASE_URL`. It throws if the
  variable is unset rather than silently connecting somewhere unexpected.
- `src/seed/` — `mock-listings.ts` (dataset), `transform.ts` (pure mapping, unit-tested with no DB),
  `seed.ts` (transactional load over a narrow queryable seam), `seed-on-start.ts` (the in-cluster
  gate) and `seed-on-start.main.ts` (its program entry — a separate file because
  `require.main === module` is silently always false inside a webpack bundle).
- **Tests live in this project**, matching `account-service/Tests/` and
  `multi-model-inference/tests/` — there is deliberately no `property-service-e2e` sibling project.
  Unit specs sit beside their subject as `src/**/*.spec.ts`; the e2e suite is
  `tests/**/*.e2e.spec.ts` driven by `jest.e2e.config.ts`. `jest.config.ts` ignores `tests/` so
  `nx test` (and CI's `nx:node-test` sweep) never runs the server-dependent suite. See #29 for the
  generator gap this avoids.

## Rules

- `source` is forced to `internal` for every seeded row, and sample titles are labelled — never
  represent sample data as MLS-sourced (PRD §6.2/§6.3). Invariants are asserted against the dataset
  in `src/seed/mock-listings.spec.ts`, not just against the transform.
- Every listing response must carry the full broker/office attribution block (PRD §6.2, NAR 7.58).
- Saved/favorited listings are #23. Property relationship claims (PRD §3.2) are not modelled yet.

## The Property API (`src/listings/`)

This service's HTTP surface is the **Property API** in prose, singular: it owns the whole
Communities → Properties → Units → Listings hierarchy, so `listings` is one resource _within_ the
API rather than the name of it. **"Property API" is informal prose only — never a metadata value.**
The published `info.title` is **`Property Service`**, matching the two entries the gateway already
aggregates (`Account Service`, `Inference Service`), and it is deliberately named for neither a
client (`cribstop-next` is one consumer of the document, not its owner) nor a resource. The
resource-level names (`listing_search_v`, the `listings` table, `ListingCardRow`,
`ListingsEnvelope`, the `searchListings`/`getListing` operation ids) are correct as they are. Do not
let the API-identity naming spread onto them.

`GET /listings`, `GET /listings/meta`, `GET /listings/{id}`, `GET /openapi.json`, `GET /health`. A
second resource later **extends the same OpenAPI document** rather than publishing a second one: the
aggregation key is a segment of the gateway's docs URL, so splitting breaks every bookmark.

**This service serves `/listings/*`; consumers call `/property/listings/*`.** Every service is
namespaced at the gateway by its bounded context, and Ocelot rewrites — the upstream templates in
`apps/api-gateway/Configuration/Routes/property-service-routes.json` are `/property/listings`,
`/property/listings/meta` and `/property/listings/{id}`, while the downstream templates (and
therefore this service's routes and the OpenAPI document's `paths`) stay `/listings/*`. Two
consequences that bite:

- Because upstream and downstream now differ, that route file **must** keep
  `"TransformByOcelotConfig": true`, or `MMLib.SwaggerForOcelot` republishes the raw `/listings`
  paths on the aggregated docs page and every "Try it out" 404s against a path the gateway does not
  expose. `inference-service-routes.json` sets it for exactly this reason; `account` can leave it
  false only because its paths are identical on both sides.
- The namespace never subsumes the resource segment. `/property/{id}` is forbidden: it collides
  permanently with every future literal segment under `/property/`, and the durable-home resource
  gets its own — `/property/homes/{id}`, never `/property/properties/{id}`.

One file per responsibility, and the split is deliberate — the pure ones are unit-testable with no
database, which is why nearly all of the logic lives in them:

| File                          | Responsibility                                                           |
| ----------------------------- | ------------------------------------------------------------------------ |
| `columns.ts`                  | The enumerated projections and `FORBIDDEN_COLUMNS`                       |
| `sold-gate.ts`                | `visibleListingTypesFor()` — THE sold-visibility decision                |
| `suppression.ts`              | `applyAddressSuppression()` — THE response-boundary suppression          |
| `listing-search-view.spec.ts` | The CI guard over the view's own SQL (#48/#59)                           |
| `search-query.ts`             | `buildSearchQuery()` — validated request to `{ where, params, orderBy }` |
| `map-row.ts`                  | DB row to wire shape, each ending in the contract's own `.parse()`       |
| `repository.ts`               | The only module executing read SQL                                       |
| `routes.ts`                   | Express wiring, strict parse, status codes, cache headers                |

### Rules with teeth (each one is a compliance failure if broken, not a style lapse)

- **Every read goes through `listing_search_v`.** It _enforces_ the display rules rather than
  carrying flags for callers to remember. No parameter, header or flag bypasses it, and none of its
  predicates is restated in a handler's `WHERE` clause.
- **Enumerate columns, never `SELECT *`.** The view no longer projects the unmasked `street_line`
  beside the masked `address` (**#48**, closed by migration `1785801600010`), so this is now defence
  in depth rather than the sole barrier: `SELECT *` would still read the view's compliance predicate
  inputs, and whatever a future migration adds, with no review. `app.spec.ts` asserts no statement
  contains a wildcard or that column name; `src/listings/listing-search-view.spec.ts` asserts the
  view itself never projects a street line outside the `address_display_allowed` mask.
- **No `COALESCE` on `beds`/`baths`/`sqft`** — NULL must fail the predicate so a land parcel is
  excluded by `beds>=2` instead of matching a fabricated `0`. `minSqft` is **living area**. No
  `COALESCE(neighborhood, city)` either: it would make the neighborhood filter match city names.
- **`street` and free-text `query` match the MASKED `address`**, never `street_line`. Filtering on
  the raw line and getting a masked row back hands the caller the address the seller opted out of.
- **`query` never searches `description`.** It is third-party MLS remarks carrying a moderation
  state; making it searchable turns "great for families" into a matchable term (PRD §6.3). It is an
  explicit non-goal in the OpenAPI description _and_ an assertion, because it will look like an
  obvious enhancement to someone later.
- **No field-selection parameter; unknown query parameters are 400.** The only durable guarantee
  that no caller can strip attribution.
- **Every sort is a total order** with an `id` tiebreaker, or page 2 repeats page 1 and the exact
  `total` stops meaning anything. `recommended` is `featured DESC, last_updated DESC, id DESC`,
  identical for every user. **Never introduce a per-user ranking signal** — personalised ranking on
  housing inventory is a steering vector and goes through product and legal, not a sort key.
- **`sponsored` is derived from `featured_reason = 'paid'`**, never from `featured`. Paid placement
  ranked first with no label is an FTC / PRD §6 failure; nothing may be `'paid'` until #24 can
  render the label.
- **`404` is byte-identical** for unknown, soft-deleted, view-excluded and malformed ids. Never 403,
  never a distinct message.
- **No `isSaved`/`isFavorited`** (#23/#25). They make every search response per-user and
  uncacheable.

### Gotchas already paid for once

- **`COUNT(*)` and the page run in ONE `REPEATABLE READ READ ONLY` transaction.** `now()` is
  transaction-scoped and the view compares `ends_at > now()`, so separate transactions can disagree
  about which rows match `openHouse=true` — `total` would describe a result set the page never came
  from, and the client computes `pageCount` from that number.
- **Express 4 does not await handlers.** An unforwarded rejection leaves the request hanging until
  the client times out, presenting as a gateway 504 and pointing the debugger at the wrong layer.
  Use the `asyncRoute` wrapper; forgetting it is a silent-hang bug.
- **`pg` parses `date` into a JS `Date` at LOCAL midnight.** `src/db/pool.ts` overrides it to return
  the raw `YYYY-MM-DD` string, because the contract declares `closeDate` as `z.iso.date()` and,
  worse, west of UTC the instant lands on the previous calendar day — a sale would publish as having
  closed a day early, with no type error anywhere.
- **`pg`'s type parsers never see a value nested inside `json_agg`/`json_build_object`.** Postgres
  serialises the JSON itself, so a `timestamptz` arrives as the string `...+00:00` rather than a
  `Date` — and the contract's `z.iso.datetime()` accepts only the `Z` form. This shipped a 500 on
  every `GET /listings/{id}` with an upcoming open house, while the card path was fine because it
  converts explicitly. **Route every instant through `instant()`**, whichever query produced it: one
  wire format per service, not one per code path. The class of bug is wider than timestamps — any
  per-column parser you rely on is bypassed inside a JSON aggregate.
- **A disjunctive filter must be bracketed** before it joins the AND-chain in `search-query.ts`.
  `AND` binds tighter than `OR`, so an unbracketed group reassociates and every branch after the
  first bypasses _every_ other filter, including the sold gate. There is a general invariant test
  for this.
- **Mappers end in `.parse()`, never a cast.** `unknown as ListingCardRow` asserts nothing at
  runtime, so an attribution key that quietly stops being sent would ship silently.

### e2e fixtures — why they exist and why they fail loudly

The seed dataset has **zero** suppressed addresses, zero suppressed listings, zero unapproved
descriptions, zero non-consumer statuses, zero `Land` rows and zero NULL beds/baths/sqft, so every
compliance assertion in this repo was **vacuously true** before #22. `tests/support/fixtures.ts`
supplies one row per scenario, behind three independent guards: it lives in `tests/` (not bundled,
not in the image context, ignored by `nx test`), it refuses to run unless
`PROPERTY_SERVICE_E2E_FIXTURES=1` and unconditionally when `NODE_ENV=production`, and every row is
`is_sample` with a `(Sample)`-suffixed title and an `internal` source.

The e2e suite **throws rather than skipping** when the fixtures are absent. A suite that silently
skips reproduces the vacuous-assertion problem with extra steps. CI does not run `nx e2e`, so this
cannot break CI:

```bash
DATABASE_URL=... PROPERTY_SERVICE_E2E_FIXTURES=1 pnpm exec nx e2e property-service
```

Note the e2e harness and the in-cluster port-forward both use **3002**; pass `PORT=3003` (honoured
by `main.ts` and the harness alike) to run the suite while `skaffold` holds that port.

### The writer carries the suppression flags — keep it that way

`ListingRow` requires `internet_display_allowed`, `address_display_allowed`,
`description_moderation` and `featured_reason`, and `OpenHouseRow` requires `remarks` and
`is_cancelled`. They are **required, not optional-with-default**: all of these columns have
permissive database defaults, so an optional field would let a future MLS mapper that forgets to
carry `InternetEntireListingDisplayYN` publish a listing the seller withheld, silently and with no
error at any layer. Required makes that omission a compile error. Do not relax them.
