# Property Service (property-service)

Node.js + Express + PostgreSQL service owning the **Communities → Properties → Units → Listings**
hierarchy (PRD §3), the consumer listing model (§3.1), and eventually Bright MLS ingestion and
property-relationship claims (§3.2). Nx project name: **`property-service`**. Port **3002** (PRD
§2.1). The first Node service in this repo that talks to Postgres.

## Commands

```bash
pnpm exec nx serve property-service        # Run locally (port 3002)
pnpm exec nx test property-service         # Unit tests — no database required
pnpm exec nx e2e property-service          # Boots the service, then hits it over HTTP
pnpm exec nx lint property-service         # Also: type-check, build
pnpm exec nx run property-service:migrate       # Apply migrations (needs DATABASE_URL)
pnpm exec nx run property-service:migrate-down  # Roll back the last migration
pnpm exec nx run property-service:seed          # Load the sample dataset
pnpm run skaffold:services                 # Deploy into the local cluster
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
remember: it masks the address _and_ the coordinates together when `address_display_allowed` is
false (the point re-identifies the address), withholds suppressed descriptions, excludes statuses
with no `consumer_status`, and gates solds on `close_date`.

## Database

Owns `property_db`, which the Postgres StatefulSet provisions along with `property_service_db_user`
and the `uuid-ossp` / `postgis` / `pg_trgm` / `btree_gist` / `vector` extensions — see
`infra/k8s/base/configmaps/postgres.configmap.yaml`. This service does **not** create the database;
it only owns the schema inside it.

Postgres is **18** (`infra/docker/postgres/Dockerfile` — PostGIS + pgvector), so `uuidv7()` is
native and every primary key uses it rather than random `uuid_generate_v4()`.

- **Local**: copy `.env.example` to `.env` and set `DATABASE_URL`. Migrations run via the `migrate`
  target, which uses `--envPath .env`.
- **In-cluster**: `DATABASE_URL` is assembled in the Deployment from `postgres-svc` plus the
  `PROPERTY_SERVICE_DB_USER_PASSWORD` key of `postgres-secret`. Migrations run in a **`migrate`
  initContainer** using the same image, invoking `node-pg-migrate` directly — deliberately with no
  `--envPath`, because containers get env vars, not a `.env` file.
- Migrations are plain CommonJS in `migrations/` and are **not** part of the webpack bundle, so the
  Dockerfile copies that directory into the runtime image explicitly. If you move it, the
  initContainer silently has nothing to apply.

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
  `seed.ts` (transactional load over a narrow queryable seam).
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
- No public REST API beyond `GET /health` yet — search/detail is #22, saved listings #23.
