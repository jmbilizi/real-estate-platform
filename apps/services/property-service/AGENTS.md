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
pnpm run infra:local:property-db:url            # Derive DATABASE_URL from the local cluster
pnpm exec nx run property-service:migrate       # Apply migrations (needs DATABASE_URL)
pnpm exec nx run property-service:migrate-down  # Roll back the last migration
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
containment is structural, and `write-containment.spec.ts` asserts no other module issues
INSERT/UPDATE on the table. `upsertListing()` resolves the snapshot itself and ignores whatever the
caller passed for those columns; it refuses to re-snapshot a terminal listing, and
`applyTerminalCorrection()` is the audited path for correcting one.

`properties.address_key` (from `src/db/address.ts`) is the deduplication identity. Never insert a
property blindly — use `getOrCreateProperty()`, or one physical building becomes two rows and two
accounts can each hold an approved `owner` claim on it.

**Fair Housing: never add these columns** to properties/units/listings — no `attributes jsonb` bag
(a RESO mapping exposes `HighSchoolDistrict`, `ElementarySchool` and similar, so an open bag
persists steering-adjacent fields with no migration to review), no `keywords`/`tags`/`features`
free-text array, no `school_rating`/`crime_index`/`safety_score`/`desirability`/demographic columns,
and no audience/segment column on anything holding consumer-visible copy. `amenities` is a closed
15-value set (`AMENITIES` in `src/db/constants.ts`) enforced by a DB CHECK.

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

- **Local**: run `pnpm run infra:local:property-db:url` (#58). It derives `DATABASE_URL` from the
  running local cluster and writes it into the gitignored root `.env`, which Nx loads for every
  task. Nothing is transcribed by hand and no `kubectl` call is yours to make. It reads the user,
  the database name and the URL shape from the live `property-service` Deployment, the password from
  `postgres-secret`, and the host port from the `postgres-svc` `portForward` entry in
  `skaffold.yaml`. A wrong kube context, an absent Deployment or a closed port each refuse by name.
  This is the workstation path for `migrate`, `migrate-down` and the e2e compliance fixtures.
  - The password it reads is the committed placeholder on the local cluster, so it is **not
    sensitive** there: local-only, gitignored, never shared. Dev, test and prod are unchanged, and
    CI substitutes real values in memory. The script still refuses any context but the local
    cluster, so it cannot lift a real credential onto a workstation.
- **In-cluster**: `DATABASE_URL` is assembled in the Deployment from `postgres-svc` plus the
  `PROPERTY_SERVICE_DB_USER_PASSWORD` key of `postgres-secret`. Migrations run in a **`migrate`
  initContainer** using the same image, invoking `node-pg-migrate` directly.
- Migrations are plain CommonJS in `migrations/` and are **not** part of the webpack bundle, so the
  Dockerfile copies that directory into the runtime image explicitly. If you move it, the
  initContainer silently has nothing to apply.

### No environment holds sample or test-feed data (#340)

Stakeholder ruling 2026-09-26: environments are protected now, so no environment needs sample or
Bright test-feed data. The in-cluster seeder (`src/seed/`, `PROPERTY_SERVICE_SEED_ON_START`, the
`seed` Nx target) is removed. `write-containment.spec.ts` fails the build if any `src/` code path
pairs `is_sample: true` with `source: 'internal'` on a `listings` row, so the pattern cannot come
back unnoticed.

`deleteSampleData()` in `src/db/write.ts` still exists — `bright-map/sweep.ts` (#331) calls it when
an environment's configured Bright tier changes, to clear the other tier's `is_sample = true` rows.
The deletes are ordered by the foreign keys, not by preference — `listing_events` is
`ON DELETE RESTRICT` on both `listings` and `properties`, so history goes first — and the durable
tables are guarded by `NOT EXISTS` so a property, unit or community that any **non-sample** listing
still references survives (PRD §6.3).

`property_db` in a freshly deployed environment is empty until the `bright-sync-worker` backfill
runs (see "The Bright sync worker" below).

### The MLS attribute model — the long tail of the feed (#127)

A licensed MLS feed carries a couple hundred fields. The shape decision, made in migration
`1785801600013` and not reversible cheaply once #93 writes real data: **the columns the product
filters and sorts on stay first-class columns on `listings`** (price, beds, baths, living area,
status, city/state/zip, geo — `idx_listings_live_price` is why), **and everything else goes into a
governed typed attribute store.** Four tables:

- **`mls_fields`** — one row per field we accept. Identity is
  `(originating_system, reso_resource, field_name)`, so onboarding a second MLS is rows, not DDL,
  and the same RESO standard field from two systems is deliberately two rows (entitlement and
  classification differ per market).
- **`mls_lookup_values`** — one row per permitted value of an enumerated field. This generalises the
  `listing_statuses` precedent to every field. **Adding a value Bright invented last week is an
  INSERT** — no migration, no redeploy.
- **`listing_attributes` / `property_attributes`** — the typed stores. Offer-scoped vs durable, the
  same split `listings` vs `properties` already makes.

**There is no text value column, and there must never be one.** A value is either a reference to a
registered lookup value or a typed scalar (`value_numeric` / `value_boolean` / `value_date` /
`value_timestamp`). That is what keeps this from being the `attributes jsonb` bag forbidden below —
free text here is unrepresentable rather than merely discouraged, so a steering phrase has no column
to land in. A consequence that looks like an omission but is not: an identifier-shaped field (parcel
number, subdivision name) is also unstorable this way, and gets a reviewed column if the product
needs it. `src/db/mls-attribute-model.spec.ts` asserts all of this against the DDL the migrations
actually emit, across every migration, so a later append cannot quietly add one.

**Governance is enforced by composite foreign keys, not by the writer's discipline** — an
unregistered field or value, a field written to the wrong table, or a value in the wrong typed
column are all constraint violations even from a manual `psql` session. `value_kind` and
`field_scope` on the attribute rows are denormalised copies of `mls_fields` columns that exist only
to be the second half of those keys; they are not data.

**`src/db/mls-attributes.ts` is the only module that writes these four tables**, mirroring (not
merged into) `write.ts`'s rule — `write-containment.spec.ts` asserts both directions. The reason
differs and is worth keeping straight: `write.ts` exists because the dwelling snapshot is
drift-capable and _cannot_ be constrained; this module exists for the fail-closed **behaviour** the
constraints cannot express — an unregistered value is detected first and returned as a structured
rejection, so one unknown vocabulary token does not abort the ingest of a whole batch. Rejections
are diagnostics for an ingestion run to record (#93 owns retention); this module persists none of
them, and truncates the offending value to 120 characters, because a value long enough to be prose
is by that fact not a lookup token.

**A field's address exposure is a closed-vocabulary classification, not a bare flag** (#128, after a
2026-09-19 regression: this whole section, the registry migration and its writer module were deleted
by the #91 merge — see #188 for the root cause — and restored across #128 and a separate
migration-only fix). `mls_fields.address_classification` is one of `carries_address`,
`re_identifies_address`, `free_text_may_contain_address` or `not_address_bearing`, and it may be
**NULL** — an explicitly unreviewed field. `is_address_bearing` is derived from it
(`registerMlsField` computes `classification !== 'not_address_bearing'`, true for NULL too) and a
CHECK ties the two so they cannot disagree. **A field nobody has classified is therefore invisible
rather than public** — the inverse of the column-by-column suppression rule that fails open on every
field nobody thought about (#53). `registerMlsField()` deliberately offers no way to set
`is_consumer_displayable`, and its `ON CONFLICT` never re-asserts `address_classification` or
`is_address_bearing`, so a `$metadata` re-pull cannot silently revert a human's review.

**The exclusion happens in SQL, inside `getListingAttributes()`/`getPropertyAttributes()` in
`repository.ts`, not in app code.** This is a genuinely different guarantee from #48/#59/#105, and
weaker language would hide that: those three null or drop a few already-fetched fields on rows
`listing_search_v` already returned. This filters a WHOLE TABLE FAMILY the view never projects, read
by a statement of its own — there is no row for a suppressed value to arrive on and then be
stripped. `getListingAttributes()` joins `listing_search_v` on the listing's OWN id and gates
`mls_fields.is_address_bearing` in the WHERE clause, so an address-bearing row for a suppressed
listing never leaves Postgres: no caller-supplied flag, nothing for a debug log or an early return
to leak. A listing absent from the view (excluded, soft-deleted) fails the join and returns nothing,
matching the view's own row-visibility rule.

**`property_attributes` has no single listing to key on, so its rule is deliberately different and
conservative.** A durable, offer-independent fact belongs to the property across every listing it
has ever carried. `getPropertyAttributes()` excludes an address-bearing attribute when ANY VISIBLE
listing on the property has its address suppressed, via
`NOT EXISTS (... listing_search_v ... address IS NULL)` — never keyed on one caller-chosen listing.
A property with one suppressed and one published listing withholds its address-bearing attributes
from both, because publishing them through the published listing would still hand a reader the fact
the other listing's seller opted out of. Fail-closed, matching the default-deny rule the rest of
#128 already applies. "Visible" means visible in `listing_search_v`; an excluded or soft-deleted
listing contributes no suppression state.

**Nothing is exposed to a consumer yet**: no contract change, no API field, and nothing outside
these two functions' own tests calls them. `columns.ts` carries the enumerated projection. Whatever
eventually exposes an attribute filters on `is_consumer_displayable` too — a separate governance
axis neither function here decides.

`listings.amenities` and `properties.property_type` keep their CHECKs and are untouched; whether to
converge them onto this store later is deliberately left open in both directions.

### The Bright sync worker (`src/jobs/bright-sync/`) — replicate, then search our own store (#338)

`GET /listings` reads Postgres only. It never calls Bright and never waits on it. One long-running
Deployment, `bright-sync-worker`, keeps `property_db` a copy of the feed. It is this image with a
different command (`node bright-sync-worker.js`, a `webpack.config.js` entry), so `src/db/write.ts`
stays the only writer of `listings`. It replaced three CronJobs (`bright-mls-ingest`,
`bright-area-refresh`, `bright-area-reconcile`) and the on-demand area load. The old ingest job
never fetched a record on production: its unbounded `ModificationTimestamp ge <cursor>` page timed
out at 120 s.

**Single-flight.** The worker holds a session advisory lock (`SYNC_LOCK_KEY` in `store.ts`) on a
dedicated connection for its whole life. A second replica waits. One task runs at a time.

**Startup**, after the lock: runs a dead worker left `running` are marked failed, then
`sweepOtherFeedTiers()` (`bright-map/sweep.ts`) runs. A switch from the test tier to production
drops every test-feed listing before any backfill writes production rows. A deploy or a restart
never re-runs a full backfill on its own (2026-09-27 ruling). `resetBackfillIfEmpty()` (`worker.ts`)
resets the backfill checkpoints only when the tier has no live listing left, so a purge or a restore
that empties `listings` while the checkpoint still reads complete still refills.

**The four modes** (`sync.ts`, pure over injected deps; `worker.ts` supplies the real ones):

- **Backfill.** Per status, `drainSlices` (`sync.ts`) reads every record modified in `(EPOCH, now]`
  as `ModificationTimestamp`-window slices sized by `$count` (Bright ignores `$orderby=ListingKey`,
  so a keyset skips records — see the module header), split by `ListingKey` range when one instant
  outgrows a page. `$select` = `BRIGHT_SYNC_SELECT`, `$top` = `BRIGHT_SYNC_PAGE_SIZE` (default
  5,000, max 10,000). Sibling slices fetch concurrently, up to `BRIGHT_SYNC_CONCURRENCY` (default 6,
  halved for the rest of the run on a 429 or a 5xx). Slices then apply concurrently too, up to
  `BRIGHT_SYNC_APPLY_CONCURRENCY` (default 4, #359) — the write path, not the fetch, is the sync's
  actual bottleneck. Each apply stages and maps on its own pool connection; a `Sequencer`
  (`sync.ts`) still writes `bright_sync_state` (`backfill:<status>`) in oldest-slice-first order,
  only once a slice's own data has committed AND every earlier slice's checkpoint write already
  landed. So a restart always resumes right after the last slice that is actually, contiguously, in
  the database — never past one still in flight or one that failed — and the upserts make any
  re-applied slice a no-op. The worker resumes an incomplete backfill before any other task.
- **Sold.** `Closed` runs only with `CloseDate ge today - BRIGHT_SOLD_LOOKBACK_DAYS` (default 365),
  and only when `BRIGHT_SOLD_DISPLAY_DELAY_DAYS` is set. Unset, every sold fails closed in the
  mapper, so the pass would stage about 315,000 records to publish none. It is skipped. Both base
  Deployments (`bright-sync-worker`, `property-service`) set it to `0` (#228, ruling 2026-10-08): a
  sold displays from its close date. A change of the window is one edit in each Deployment.
- **Incremental**, every `BRIGHT_SYNC_INCREMENTAL_INTERVAL_MS` (5 min): the window
  `(watermark - 2 min, now]`, every status, ordered `ModificationTimestamp asc,ListingKey asc`. The
  watermark moves only after every page commits. A follow-on page starts at the last instant,
  inclusive, because Bright rejects the `OR` a strict `(t, key)` resume needs. An instant wider than
  one page is drained by `ListingKey` keyset (`buildTieBlockQuery`).
- **Reconcile**, daily: every live `ListingKey` per status (`$select=ListingKey`). A local live
  listing absent from all of them becomes `Off Market`. It refuses when a status read falls more
  than 1 % short of Bright's own count, or when it would change more than 20 % of the local
  listings.
- **Probe**, every `BRIGHT_SYNC_PROBE_INTERVAL_MS` (daily, #715): asks Bright about every live local
  key in batches of 100 (`ListingKey in (1,2,...)`, bare digits because `ListingKey` is `Edm.Int64`,
  `$select=ListingKey,StandardStatus`). Bright rejects a batched `or`. About 91,000 keys is 910
  requests, a few minutes at the sync's request rate. A key becomes `Off Market` when Bright returns
  it in a status that search does not show, or when a complete batch answer and a read of that key
  alone both omit it. A failed, truncated or malformed batch leaves its keys live and counts as
  errors. A run that finds more than `BRIGHT_SYNC_PROBE_MAX_TAKEDOWN` (500) keys takes down nothing
  and logs the abort. Code: `src/jobs/bright-sync/probe.ts`. It has no per-environment flag.
- **Audit**, after a backfill and after each reconcile: Bright `$count` against the local count per
  status for the places in `DEFAULT_AUDIT_AREAS`. The rows go to the run's `counts`.

**The sync never deletes a listing (#349).** A held listing whose record now fails to map
(`applyPage` in `worker.ts`), or that reconcile finds absent, becomes `Off Market` through
`markListingsOffMarket()` in `src/db/write.ts`, with its reason as the `listing_events` note.
`Off Market` has no `consumer_status`, so search drops it and its page shows only the address and
the property record. It is not terminal, so the listing re-snapshots when its record maps again. A
record that maps to a non-searchable status (Withdrawn, Expired, Canceled, Hold) keeps that status.

### The property page (#349)

Every held listing has a page in its current market status. `listing_detail_v` (migration 033) is
the read model. It holds every live, internet-displayable listing. `listing_data_displayable` is
true exactly when `listing_search_v` holds the row, so the listing-data rules stay in one view.
`market_status` is `Active`, `Coming Soon`, `Under Contract`, `Pending`, `Sold` or `Off market`. Off
market covers Withdrawn, Expired, Canceled, Hold, `Off Market` and a sold outside the sold display
rule (#33). For those rows the view projects only the address (still masked on
`address_display_allowed`) and property-record facts: NAR 7.58 forbids the display of their listing
data.

- `GET /listings/:id/card` (#549) returns one `ListingCardRow`. It uses the search SELECT, mapper
  and address suppression (`findListingCardById`), and it never starts a gallery fetch. A map pin
  that is not on the results page renders its popup card from it. Unknown, removed and suppressed
  ids give the same 404 as `/listings/:id`.
- `GET /listings/:id/page` (`listings/property-page.ts`) returns `PropertyPage` from
  `@cribstop/property-contracts`. `detail` is the `/listings/:id` detail when displayable, else
  null. `path` is the address URL, null when the seller withheld the address.
- `GET /properties/lookup?city=<city-st>&address=<address-slug>` resolves the two segments of
  `/<city>-<st>/<address-slug>` (`address-slug.ts` in the contracts). It compares the normalized
  street (`normalizeStreetLine`, the same function `address_key` hashes), the unit, city, state and
  optional ZIP. A withheld address never matches. On a miss, `listings/address-loader.ts` reads the
  address from Bright once, across all statuses (`PostalCode` or `City`+`StateOrProvince`, plus
  `startswith(UnparsedAddress,'<number> <first street word>')`, `$top=50`), maps it through
  `mapBrightPayloads()`, and resolves again. One address is read at most once per
  `BRIGHT_ADDRESS_LOOKUP_COOLDOWN_MS` (1 h), so the 404 path cannot drive Bright traffic.
- **Assumption:** `UnparsedAddress` is title case (`118 Baggett Pl`), and `startswith` compares
  case-sensitively. A record in another case misses and the page answers 404.

**`bright_sync_runs`** logs every run: mode, scope, status, counts, cursor, times, error,
`requested_by`. `store.ts` is the only module that writes it or `bright_sync_state`.

**Admin endpoint** (`src/admin/bright-sync-routes.ts`): `POST /admin/bright/sync` with
`{ mode: incremental | backfill | reconcile | audit | probe, statuses?, area? }` queues a run and
returns `202 { runId }`. `GET /admin/bright/sync` and `GET /admin/bright/sync/:runId` show runs. It
needs `Authorization: Bearer <BRIGHT_ADMIN_TOKEN>` (`bright-mls-secret`). An unset token or the
committed placeholder refuses every request. `statuses` takes payload values (`ComingSoon`), never
filter labels. **Assumption:** no user auth or roles exist yet, so no gateway route exposes it.
Reach it by port-forward to 3002. Replace the token with role auth when account roles ship.

**The detail page still calls Bright** for one listing's gallery (`listings/gallery-loader.ts`),
bounded by `BRIGHT_ON_DEMAND_GALLERY_WAIT_MS`. The property lookup's miss path (above) is the only
other request-path call.

**Wire facts, all measured. Each one is a defect if rediscovered by guessing.**

- **`$filter` takes spaced labels; records carry compact values.** `StandardStatus eq 'Coming Soon'`
  returns 200, `'ComingSoon'` returns 400, and a record says `ComingSoon`.
  `BRIGHT_STATUS_FILTER_LABELS` (`bright-map/status.ts`) holds the labels; `reso_standard_status`
  holds the payload values the mapper matches. `PropertyType` behaves the same way in a filter
  (`'Residential Lease'` works). Payloads carry `Residential`, `Residential Lease`, `Multi-Family`,
  `Commercial Sale`, `CommercialLease`, `Land`, `BusinessOpportunity` (production, 2026-09-26).
- **`/$count` answers 501 on production.** A count is `?$filter=...&$count=true&$top=0`
  (`buildCountQuery`), read from `@odata.count`.
- **`City` matches case-insensitively and comes back upper case** (`WASHINGTON`). DC is audited by
  `StateOrProvince eq 'DC'`: `City eq 'Washington'` also matches other states.
- **Speed** (production, from the pod): a keyset page of 1000 answers in about 2 s with `$select`, 4
  s with full rows (25 KB per record). A bounded window answers in under 1.5 s. A 24 h window page
  takes about 8 s.
- **`$top` suppresses `@odata.nextLink`.** Every mode pages by its own key and never follows a link.
- **Bright rejects `or` in a `$filter`**:
  `400 Query Too Complex — OR Expressions allowed in top 2 levels only`. One query per status.
- **An ordered request needs a bounding filter on the ordered field**, or it does not return.
  `odata-query.ts` is the only module that writes `$orderby`; `isOrderedWithoutFilter()` guards it.
- **`BrightMedia` and `Deletion` accept no `$filter` on the IDX test tier.** The gallery fetch
  filters `BrightMedia` by `ResourceRecordKey` and falls back to `ListingId`
  (`listing-media-fetch.ts`).
- **No response carries a rate-limit header.** `rate-limiter.ts` holds a sliding-window ceiling. The
  values are slow placeholders until #33 records the licence's numbers.
- **The bearer token goes only to the configured service-root host** over HTTPS (`fetchPage`).

**Configuration and logging.** "Not configured" is a normal state: with the committed
`StrongBase64Password` placeholders the worker logs it and idles, and the Deployment does not
crash-loop. Provisioning the credential needs a pod restart. `BRIGHT_MLS_ENV` (`test` or
`production`) states the tier of `BRIGHT_MLS_CLIENT_ID` / `BRIGHT_MLS_CLIENT_SECRET`; `config.ts`
trusts it exactly and derives the endpoints. A test-feed row is marked `is_sample`. Only endpoint
hosts are logged, never URLs or credential material: `bright-client.ts` keeps only RFC 6749's closed
`error` codes from a failure body.

**Detail-page facts (#564).** `GET /listings/:id` carries tax, HOA, virtual tour, listing-agent
contact, photo captions and eight grouped facts. The list, card and map payloads carry none of them.
`bright-map/map-detail.ts` maps them, and each field name is declared in `$metadata`.

- Scalars are columns on `listings`: `tax_annual_amount`, `tax_year`, `hoa_fee`,
  `hoa_fee_frequency`, `virtual_tour_url`, `list_agent_phone`, `list_agent_email`. Grouped facts
  (parking, heating, cooling, appliances, basement, flooring, interior, exterior) are rows in
  `listing_facts`. A DB CHECK closes the group set and caps the value length. Add no group for tags,
  keywords or neighborhood character.
- `replaceListingFacts()` in `write.ts` is the only writer of `listing_facts`.
- Not mapped, because the feed does not declare them: `VirtualTourURLBranded`, a 3D or Matterport
  field, and a listing-agent photo. The listing office name and phone are the existing attribution
  fields.
- Only the unbranded tour URL shows. A branded tour carries agent or brokerage marketing.
  **Assumption:** no written Bright term confirms the IDX rule (#33).
- Suppression: `applyAddressSuppression()` nulls `virtualTourUrl` and every `caption` when the
  address is masked. Tax, HOA and agent contact stay.
- **Backfill.** A row fills when the sync next writes it. To fill every listing now, queue a full
  backfill: `POST /admin/bright/sync` with `{ "mode": "backfill" }` (port-forward to 3002, bearer
  `BRIGHT_ADMIN_TOKEN`). The migration adds the columns with no data.

**Photos.** A listing shows its `ListPictureURL` from the property record. The detail page fetches
the full gallery. The media suppression gate is lifted for Bright rows by the 2026-09-22 ruling
(#146, #33): Bright images carry their watermark and Cribstop is licensed to show them. Read it
narrowly: `priceDisplayAllowed`, `priceHistoryDisplayAllowed` and `daysOnMarketDisplayAllowed` stay
fail-closed. In `map-media.ts`, `PreferredPhotoYN === true` wins, then the lowest
`MediaDisplayOrder` (absent sorts last), then the lowest `MediaKey`. Only `MediaURL` is used, never
a size variant. A record must be identifiably a photo by `MediaType` or URL extension.
`replaceFeedListingMedia()` in `src/db/write.ts` is the writer.

### Migration rules (each of these fails silently or confusingly if ignored)

- **These files are immutable once merged.** `pgmigrations` keys applied migrations by **filename**,
  and there is no checksum check, so editing an applied migration diverges a fresh database from a
  deployed one with no error. New migrations only ever append — `checkOrder` is on, so a migration
  hand-numbered _below_ an already-applied one throws forever. CI's `tools` job runs
  `tools/validation/migration-order.js` on every PR and fails it before merge (#405); `pre-push`
  runs the same guard on a feature branch.
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
- `src/db/address.ts` (property identity), `constants.ts` (schema enums) and `types.ts` (row shapes)
  are shared by `write.ts` and the Bright mapper (`src/jobs/bright-map/`), not owned by either. They
  lived under a since-removed `src/seed/` (#340); the move is the only reason they are not still
  there.
- **Tests live in this project**, matching `account-service/Tests/` and
  `multi-model-inference/tests/` — there is deliberately no `property-service-e2e` sibling project.
  Unit specs sit beside their subject as `src/**/*.spec.ts`; the e2e suite is
  `tests/**/*.e2e.spec.ts` driven by `jest.e2e.config.ts`. `jest.config.ts` ignores `tests/` so
  `nx test` (and CI's `nx:node-test` sweep) never runs the server-dependent suite. See #29 for the
  generator gap this avoids.

## Rules

- No environment holds sample or Bright test-feed data (PRD §6.2/§6.3, #340).
  `write-containment.spec.ts` fails the build if any `src/` code path pairs `is_sample: true` with
  `source: 'internal'`.
- Every listing response must carry the full broker/office attribution block (PRD §6.2, NAR 7.58).
- Saved/favorited listings are #23. Property relationship claims (PRD §3.2) are not modelled yet.
- Listing inquiries are #131 (`src/inquiries/`). No public read endpoint. Staff read endpoints sit
  behind roles.

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
| `suppression.ts`              | THE response-boundary suppression — card and detail                      |
| `listing-search-view.spec.ts` | The CI guard over the view's own SQL (#48/#59)                           |
| `search-query.ts`             | `buildSearchQuery()` — validated request to `{ where, params, orderBy }` |
| `map-row.ts`                  | DB row to wire shape, each ending in the contract's own `.parse()`       |
| `repository.ts`               | The only module executing read SQL                                       |
| `routes.ts`                   | Express wiring, strict parse, status codes, cache headers                |

### Rules with teeth (each one is a compliance failure if broken, not a style lapse)

- **Every read goes through `listing_search_v`.** It _enforces_ the display rules rather than
  carrying flags for callers to remember. No parameter, header or flag bypasses it, and none of its
  predicates is restated in a handler's `WHERE` clause.
- **What the view structurally cannot reach is withheld in `suppression.ts`, and nowhere else.**
  Both endpoints join `listing_media` ALONGSIDE the view rather than through it, and the DETAIL
  endpoint does the same with `listing_open_houses`, so `media[].altText`, `primaryMedia.altText`
  (#105) and the detail's `openHouses[].remarks` (#59) are unreachable from any view predicate. The
  CARD's single `openHouse.remarks` is **not** in that set — it comes out of `listing_search_v`,
  which masks it on the `address_display_allowed` `CASE`, and `applyCardAddressSuppression()` never
  touches it. Do not read that view `CASE` as dead weight during the next view migration: deleting
  it reopens #59 on the search endpoint, where nothing at the response boundary would catch it.
  `applyAddressSuppression()` covers the detail response and `applyCardAddressSuppression()` the
  card — two exported functions over ONE private rule, both keyed on `address === null` (the OUTCOME
  the view decided, never `address_display_allowed`, which this service never reads) and both
  applied at the same edge of `repository.ts`. Alt text is **nulled, not substituted**, the opposite
  call from `title`: the contract declares it nullable and the client falls back to `alt=""`, so the
  honest answer is available — whereas any derived alternative would describe an image this service
  has never seen. A new media-bearing response shape reuses these, never a third mechanism.
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

A real listing set has **zero** suppressed addresses, zero suppressed listings, zero unapproved
descriptions, zero non-consumer statuses, zero `Land` rows and zero NULL beds/baths/sqft in the
general case, so every compliance assertion in this repo would be **vacuously true** without a
dataset built for it (#22, and #340 for why no environment holds sample data instead).
`tests/support/fixtures.ts` supplies one row per scenario, behind three independent guards: it lives
in `tests/` (not bundled, not in the image context, ignored by `nx test`), it refuses to run unless
`PROPERTY_SERVICE_E2E_FIXTURES=1` and unconditionally when `NODE_ENV=production`, and every row is
`is_sample` with a `(Sample)`-suffixed title and an `internal` source.

The e2e suite **throws rather than skipping** when the fixtures are absent. A suite that silently
skips reproduces the vacuous-assertion problem with extra steps. CI does not run `nx e2e`, so this
cannot break CI:

Run the suite against an empty, disposable Postgres. Do not use the shared cluster database.

```bash
# 1. A disposable database. Use the repo Postgres image (PostGIS + pgvector).
podman run -d --name e2e-pg -p 55432:5432 -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=property_db \
  localhost:5001/postgres-postgis-pgvector:<tag>
# 2. Create the extensions, then migrate.
podman exec e2e-pg psql -U postgres -d property_db -c 'CREATE EXTENSION "uuid-ossp"; CREATE EXTENSION postgis; CREATE EXTENSION pg_trgm; CREATE EXTENSION btree_gist; CREATE EXTENSION vector;'
export DATABASE_URL=postgres://postgres:pw@localhost:55432/property_db
pnpm exec nx run property-service:migrate
# 3. The one command.
PROPERTY_SERVICE_E2E_FIXTURES=1 pnpm exec nx e2e property-service
```

Expected result: **25 suites, 319 tests, all passing.** The count grows with the suite. The run
needs no other env: `tests/support/e2e-serve-defaults.js` points every account-service URL at the
introspection stub. `src/e2e-serve-defaults.spec.ts` fails if the app reads an
`ACCOUNT_SERVICE_*_URL` variable that the defaults omit. Remove the container when done. The
fixtures load with `DATABASE_URL` pointing at a database you own, so never point it at a shared one.

The e2e harness and the in-cluster port-forward both use **3002**. Pass `PORT=3003` (honoured by
`main.ts` and the harness alike) to run the suite while `skaffold` holds that port.

### The writer carries the suppression flags — keep it that way

`ListingRow` requires `internet_display_allowed`, `address_display_allowed`,
`description_moderation` and `featured_reason`, and `OpenHouseRow` requires `remarks` and
`is_cancelled`. They are **required, not optional-with-default**: all of these columns have
permissive database defaults, so an optional field would let a future MLS mapper that forgets to
carry `InternetEntireListingDisplayYN` publish a listing the seller withheld, silently and with no
error at any layer. Required makes that omission a compile error. Do not relax them.

`MediaRow.alt_text` (#105) is required for a related but distinct reason, worth stating separately
because the argument above does not transfer: the column has no default and omitting it publishes
nothing, so the failure is not fail-open. It is required so that a mapper must **declare** whether
it carries a feed's photo caption — and so the address suppression over it has a real value to
withhold. While no writer could set it, every assertion about it was vacuously true.

## Listing inquiries (`src/inquiries/`)

`POST /listings/{id}/inquiries` (#131) — a consumer's message or tour request. **There is no public
read endpoint**: an inquiry is never returned by any listings response. Staff read endpoints sit
behind roles (#632).

- **An account is required (#690).** The route runs rate limiting, then `resolveRequester`, then the
  body and listing checks. No credential gives 401 with no listing data. An unconfirmed email gives
  403 (`forbidden`). An account-service outage gives 503, never 401. The body has no `name` or
  `email`, and the route drops both if a client sends them. `listing_inquiries.account_id` is NOT
  NULL (migration 052 deleted the anonymous dev leads). A lead stores no name, email or
  `verified_account` (migration 053, #691). The buyer contact comes from account-service at read
  time. See "Buyer contact lookup".

- `write.ts` is the only module that writes `listing_inquiries`, mirroring `src/db/write.ts`'s rule
  for `listings`.
- The listing existence/visibility check reuses `listing_search_v` via `isListingPublishable()` in
  `listings/repository.ts` — the same single source of listing visibility every other route reads,
  never a second copy of the predicate.
- **Consent** (stakeholder ruling 2026-09-13): `consent_to_contact`, `consent_disclosure_text` and
  `consent_given_at` are kept consistent by a DB CHECK — all three present or all three absent,
  never a bare `true`. The disclosure text is always `CONSENT_DISCLOSURE_TEXT`
  (`@cribstop/property-contracts`), never a caller-supplied string, so the persisted record and the
  checkbox copy `#132` renders cannot drift. Consent adds a recipient; routing to the listing agent
  is unconditional and is not built in this ticket.
- **Lead model** (#627): a row is a buyer request with a lifecycle. `lead-status.ts` is the only
  transitions table. `changeLeadStatus` (`lead-status-write.ts`) moves a status and appends the
  `lead_status_events` row in one transaction. Staff and agent routes call it. The events table is
  append-only by trigger. A delete is allowed only when the lead is already gone (cascade). `phone`
  is optional. Consent evidence: the server holds the text per version (`CONSENT_TEXTS`) and stores
  text, version, channels and time. Retention target: 4 years, no purge job yet.
- **Account resolution** (`account-introspection.ts`, `requester.ts`) calls account-service's #86
  endpoint. A network error or timeout reads as `unavailable`, and the route answers 503.
- **Rate limiting** (`rate-limit.ts`) is in-memory, fixed-window, per client IP and per listing,
  configuration-driven (`INQUIRY_RATE_LIMIT_*` env vars). Per process, like the gateway's Ocelot
  limiter and account-service's `AccountRecoveryRateLimiter` — the effective limit multiplies by
  replica count. Redis is the scale-out path if that bound stops being acceptable; this ticket does
  not introduce it for one endpoint.
- **New index/DDL migrations on `listings`/`properties` use
  `pgm.createIndex(..., { concurrently: true })` plus `pgm.noTransaction()`** (Postgres refuses
  `CREATE INDEX CONCURRENTLY` inside a transaction block), because `bright-sync-worker` writes these
  tables continuously and a plain `CREATE INDEX` blocks it for the index build's duration (#388).
  Migrations 034 and 036 predate this rule and are not rewritten.

## Inquiry intake and notification outbox (`src/inquiries/outbox.ts`)

The Lead Desk dashboard is the system of record for buyer requests. No inquiry goes out by email
(ruling 2026-10-06, #629). Later email goes only to the buyer and to the matched agent.

#638 added `notification_outbox` and **no sender**. The #134 delivery worker, the Postmark channel
and the `delivery_*` columns of `listing_inquiries` are removed (migration 051). Nothing read them.

- Every lead event writes its rows in the transaction of the event. `createListingInquiry` writes
  `lead.received`. `changeLeadStatus` writes `lead.verified` (from `new`), `lead.assigned` and
  `lead.accepted` through `enqueueLeadNotifications`.
- A buyer row needs recorded email consent (`consent_channels` holds `email`). An agent row exists
  only for `lead.assigned`.
- A row holds ids only. `recipient_account_id` is always an account id: the buyer's, or the account
  of the agent profile (mapped at write time, #691). `payload` is `{ leadId }`. Never copy an email
  or a phone.
- Every row starts `held`. No code in this service updates a row. `outbox.spec.ts` fails if a source
  file updates the outbox, reads it, or calls a mail provider.
- **A later sender** claims rows in one statement:
  `UPDATE notification_outbox SET state = 'queued' WHERE id IN (SELECT id FROM notification_outbox WHERE state = 'held' ORDER BY created_at LIMIT n FOR UPDATE SKIP LOCKED) RETURNING *`.
  It resolves the address at send time (account-service contacts lookup, by account id) and
  re-checks consent. Then it sets `sent` or `failed`. A withdrawn consent sets `cancelled`. A lead
  assigned twice writes two `lead.assigned` rows, so the sender must de-duplicate. The sender is a
  new ticket. Broker sign-off (#630) and the CAN-SPAM duties come first.

The `postmark-secret` reference stays in the deployment. account-service uses Postmark for account
emails.

## Saved homes (`src/saved/`)

`PUT|DELETE /listings/{id}/saved`, `DELETE /saved-homes/{id}`, `GET /saved-homes` (#23). They extend
the Property API document. Never publish a second document.

- A save keys on `(account_id, property_id)`. `property_id` is the home id of #386: the unit id in a
  subdivided building, else the property id. `listing_id` is context only and no read uses it.
- `store.ts` is the only module that touches `saved_homes`. Every statement filters on `account_id`.
- The list is home-shaped. An off-market home returns `listing: null`. It is never a 404 and never
  dropped. `homes.ts` reads three statements per page, never one per home.
- Masking follows the property page. This module never reads the street line. `listing_detail_v` and
  `listing_search_v` mask it. One listing that withheld the address masks the whole home. A home
  with no readable listing has no address.
- Identity: `identity.ts` calls the #86 introspection client. Nothing caches the result, so a
  revoked session stops at once. The save routes answer 401 when the caller does not resolve,
  including when account-service is down.
- The read routes add `isSaved` and `isFavorited` only for a caller that resolves to an account.
  That response is `private, no-store`. An anonymous response stays public and byte-identical.

## Staff roles (#628)

- `src/staff/roles.ts` holds `requireRole(introspection, ...roles)`. It is any-of. `SuperAdmin`
  passes any check that allows `Admin`. It answers 401 (no valid credential), 503 (account-service
  down) or 403 (no allowed role). Read the caller with `staffCallerOf(res)`.
- `GET /staff/me` returns `{ roles }` for any valid credential. It needs no role.
- Introspection runs once per request. Nothing caches it.

## Buyer contact lookup (#691)

- A lead keeps `account_id` only. Staff list and detail, agent list and detail read `displayName`,
  `email` and `emailConfirmed` from account-service `POST /internal/account/contacts` (#689).
  `src/inquiries/account-contacts.ts` is the client. Env: `ACCOUNT_SERVICE_CONTACTS_URL` and
  `ACCOUNT_SERVICE_CONTACTS_TIMEOUT_MS` (default 1500). Same in-cluster trust as introspection.
- One lookup per list page. The client splits at 100 ids. Nothing is cached.
- A failed lookup returns `null`. Lists still return every lead with `name`, `emailMasked` and
  `verifiedAccount` null. A detail still returns the lead with `name`, `email` and `verifiedAccount`
  null, and the audit row is still written. An id that account-service does not return reads the
  same way. The UI shows "Unavailable, retry". No error names account-service.
- Masking is unchanged: staff lists mask, staff detail is full, an agent sees the contact only after
  accept.
- The e2e stub (`tests/support/introspection-stub.ts`) also serves the contacts endpoint.
  `e2e-serve-defaults.js` points every account-service URL at it.

## Staff lead desk (#632)

- `src/staff/leads-routes.ts` serves `/staff/leads` (list), `/staff/leads/:id` (detail),
  `/staff/leads/:id/transition` and `/staff/leads/:id/notes`. Allowed: `Admin`, `SuperAdmin`,
  `Moderator`. `Agent` and buyers get 403.
- The list masks email and phone. Name and email come from the buyer account (see "Buyer contact
  lookup"). Only the detail returns full values, and every detail read writes a `lead_access_audit`
  row before the service reads the rest. A failed audit insert returns 500.
- A Moderator sets `verified`, `spam` and `rejected`. Admin also sets `new` (undo spam). Every
  change runs through `changeLeadStatus`. A note is required for `spam` and `rejected`.
- `possibleDuplicate`: another open lead, same listing, within 7 days, same buyer account or last
  ten phone digits. It is a hint. Nothing merges or drops a lead. The indexes of migrations 048
  (phone) and 053 (account) match the expressions in `leads-store.ts`. Change both together.
- `lead_notes` and `lead_access_audit` are append-only by trigger.
- The e2e stub carries roles in the bearer token: `bearerFor(accountId, ['Admin'])`.
- `GET /staff/leads/metrics` (#639, `metrics-store.ts`) returns counts, the median and p90 of time
  to verify, assign and accept, and an aging count. Read-only. No PII. `from` and `to` select leads
  by creation time and apply to every value. A step is the first `to` event of a lead minus the
  latest `from` event before it. Register it before `/staff/leads/:id`. `LEAD_AGING_HOURS` sets the
  aging age (default 24). It needs no migration: the 047 indexes serve it.

## Agent directory and assignment (#634)

- `src/staff/agents-routes.ts` serves `/staff/agents` (list, create) and `/staff/agents/:id` (read,
  patch). `Admin` and `SuperAdmin` write. `Moderator` also reads. Deactivate with
  `PATCH { active: false }`. Open assignments stay.
- Create and reactivate check the `Agent` role through account-service `GET /account/{id}/roles`
  with the caller credentials (`agent-role-check.ts`). A Moderator cannot ask account-service, so
  assign trusts the profile and its `active` flag. Remove a role, then deactivate the profile.
- `POST /staff/leads/:id/assign` takes `{ agentProfileId }` and nothing else. No reason field.
  Allowed from `verified` only. Only the licence state and the listing state decide a match
  (`checkAgentForLead`). Licence states are two-letter codes held as data. No market is hard-coded.
- `POST /staff/leads/:id/unassign` takes a required note. Reassign is an unassign, then an assign.
- Both run through `changeLeadStatus`. Its `precheck` runs behind the lead row lock. Any return to
  `verified` ends the open `lead_assignments` row. `uq_lead_assignments_one_open` allows one open
  row per lead. History rows are never deleted.
- The e2e stub answers the role check from `setAccountRoles(accountId, roles)`.

### Agent "My leads" (#636)

- `src/agent/agent-leads-routes.ts` serves `GET /agent/leads`, `GET /agent/leads/:id` and
  `POST /agent/leads/:id/{accept,decline,status}`. The guard is the `Agent` role plus an ACTIVE
  `agent_profiles` row for the account. A missing profile answers 403.
- Every query joins on the OPEN `lead_assignments` row of the caller profile. A lead of another
  agent, an unassigned lead and a malformed id all answer 404, never 403. The ownership check runs
  BEFORE the transition check, so a 409 never confirms that a lead exists.
- Before accept (`assigned`) the detail has `contact: null`. The list always masks. Accept moves to
  `accepted`, sets `lead_assignments.accepted_at` and reveals the contact.
- Decline takes a reason from `AGENT_DECLINE_REASONS`, only while `assigned`. It stores
  `decline_reason`, ends the assignment with `end_reason = 'declined'` and returns the lead to
  `verified`. No lead status is new.
- `status` takes `contacted`, `touring`, `under_contract`, `closed` or `lost`, only after accept.
  `closed` and `lost` end the assignment, so the lead leaves the agent list.
- Every change goes through `changeLeadStatus` with `actorRole = 'Agent'`. Every detail read writes
  a `lead_access_audit` row with role `Agent`.

## One card per home (#716)

Search, the result total, the page count and the map pins show one card per home. A home can have
several live MLS records. `src/listings/collapse.ts` hides a record when a better record of the same
home exists. It runs inside `buildSearchQuery`, on every query, with no flag and no stored state.

- Same home: same property, unit, listing type and listing office. Beds, baths and area agree when
  both records have them. Prices are within 2x. A hidden price keeps the records apart.
- Never merged: lots and land, Multi-Family and Condo records with no unit, a home with live records
  from more than one office. `property_is_parcel()` (migration 055) holds the street-line test,
  because application SQL must never name `street_line`.
- Winner: latest `listed_at`, then Active over Coming Soon over Pending, then latest
  `source_modification_timestamp`, then the greater id. The collapse ranks all live records first
  and the request filters apply to the winner. A home whose current record is Pending is absent from
  a default search.
- Only live statuses count. An off-market record never wins and never counts. A hidden record still
  opens at `/listings/:id`. The detail response lists the other live records in `alsoListedAs`.
- Every transaction that reads `collapseCondition` runs `DISABLE_JIT_SQL` first.
- `listings.source_listing_id` holds the MLS number (`ListingId`). A value equal to the feed key is
  an older row and reads as unknown until the sync writes the row again.
