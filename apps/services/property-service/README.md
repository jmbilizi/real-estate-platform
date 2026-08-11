# property-service

Node.js + Express service owning the property domain: the **Communities → Properties → Units →
Listings** hierarchy (PRD §3) and the consumer listing model (PRD §3.1).

Backed by the `property_db` PostgreSQL database, which infra already provisions with `uuid-ossp`,
`postgis`, `pg_trgm`, and `btree_gist` (`infra/k8s/base/configmaps/postgres.configmap.yaml`).

> **Scope today.** Schema, migrations, a seed dataset, and the **Property API** — listings search,
> detail and dataset freshness. Saved/favorited listings are #23; property relationship claims (PRD
> §3.2) are not modelled yet.

## The Property API

This service's HTTP surface is the **Property API**, singular — it owns the whole Communities →
Properties → Units → Listings hierarchy, so `listings` is one resource _within_ the API rather than
the name of it. **The URL paths stay `/listings/*`: a service name is not a resource name.** A
second resource later extends the same OpenAPI document rather than publishing a new one, because
the aggregation key is a segment of the gateway's docs URL.

| Endpoint             | Purpose                                                                     |
| -------------------- | --------------------------------------------------------------------------- |
| `GET /listings`      | Search. Envelope with an **exact** `total`, page info, and `appliedFilters` |
| `GET /listings/meta` | Dataset freshness — callable without running a search                       |
| `GET /listings/{id}` | Detail: the nested `{ property, unit, listing }` graph                      |
| `GET /openapi.json`  | The generated document the gateway's `MMLib.SwaggerForOcelot` aggregates    |
| `GET /health`        | Liveness/readiness                                                          |

Request parsing, response shapes and the published OpenAPI document all come from
`@cribstop/property-contracts`. This service adds SQL and HTTP and **never** a second copy of a
shape. Never hand-write an `openapi.yaml`: it becomes a second source of truth that drifts from the
request parser silently.

### Rules that are not negotiable in this layer

- **Every read goes through `listing_search_v`**, which _enforces_ the display rules rather than
  carrying flags for callers to remember. There is no parameter, header or flag that bypasses it,
  and none of its predicates is restated in a handler's `WHERE` clause — a second copy of a
  compliance rule is a second place for it to drift.
- **Columns are enumerated** (`src/listings/columns.ts`), never `SELECT *`. The view still carries
  the unmasked `street_line` beside the masked `address` (**#48**), so enumerating keeps that value
  out of this process entirely instead of reading it and dropping it later. `FORBIDDEN_COLUMNS`
  names it and a unit test enforces the absence.
- **No `COALESCE` on `beds`/`baths`/`sqft`.** NULL must fail the predicate, so a land parcel is
  excluded by `beds>=2` rather than coerced to a fabricated `0`. `minSqft` is **living area**, never
  lot size. Equally: no `COALESCE(neighborhood, city)`, which would make the neighborhood filter
  match city names.
- **No field-selection parameter, and unknown query parameters are rejected with 400.** That is the
  only durable guarantee a caller cannot strip the NAR 7.58 attribution block, and it kills the
  silent-typo'd-filter bug at the same time.
- **Two compliance decisions have exactly one named function each**, so a rule change is one edit:
  `visibleListingTypesFor()` (`src/listings/sold-gate.ts`) decides sold visibility —
  `listingType=all` means sale + rent and sold is opt-in — and `applyAddressSuppression()`
  (`src/listings/suppression.ts`) nulls `unit.unitNumber` whenever the view masked the address.
- **`404` is byte-identical** for an unknown id, a soft-deleted id, a view-excluded id and a
  malformed id. A 403 or a distinct message is a confirmation oracle that defeats the seller's
  opt-out.
- **Sorts are total orders.** Every sort ends in an `id` tiebreaker or page 2 repeats page 1 and the
  exact `total` stops meaning anything. `recommended` is `featured DESC, last_updated DESC, id DESC`
  and is identical for every user — **no per-user ranking signal may be introduced**, now or later:
  personalised ranking on housing inventory is a steering vector and goes through product and legal,
  not a sort key.
- **No `isSaved`/`isFavorited`** (#23/#25 own saved state). The moment they appear every search
  response becomes per-user and uncacheable — a permanent architectural cost for a boolean.

### Two traps this layer has already been bitten by

- **Search runs its `COUNT(*)` and its page in one `REPEATABLE READ READ ONLY` transaction.**
  `now()` is transaction-scoped, and the view compares `ends_at > now()`, so separate transactions
  can disagree about which rows match `openHouse=true` — `total` would then describe a result set
  the page never came from.
- **Express 4 does not await handlers.** An unforwarded rejection leaves the request hanging until
  the client times out, which presents as a gateway 504 and sends whoever debugs it to the wrong
  layer. Every handler goes through the `asyncRoute` wrapper in `src/listings/routes.ts`.

### Caching

`/listings` and `/listings/{id}` are `public, max-age=60` — they embed a time-relative fact (the
upcoming open house), so 60s is the ceiling. Deliberately **not** `no-store`: these payloads carry
no PII and must not start to. `/listings/meta` is
`public, max-age=60, s-maxage=300, stale-while-revalidate=60`; the browser TTL stays short because
`Footer` renders on every route, so a long session must not drift.

## Configuration

| Variable       | Purpose                                                     |
| -------------- | ----------------------------------------------------------- |
| `DATABASE_URL` | Postgres connection string for `property_db`. Required.     |
| `PORT`         | HTTP port. Defaults to `3002` per the PRD §2.1 service map. |

Copy `.env.example` to `.env` for local work. Credentials never belong in source.

## Commands

```bash
pnpm exec nx serve property-service          # Run locally (port 3002)
pnpm exec nx test property-service           # Unit tests — no database required
pnpm exec nx lint property-service
pnpm exec nx type-check property-service
pnpm exec nx build property-service

pnpm exec nx run property-service:migrate       # Apply migrations (needs DATABASE_URL)
pnpm exec nx run property-service:migrate-down  # Roll back the last migration
pnpm exec nx run property-service:seed          # Load the sample dataset

pnpm exec nx e2e property-service        # Boots the service, then hits it over HTTP
```

Unit tests mock the `pg` client and never open a connection, so they run anywhere. There is
deliberately **no `property-service-e2e` sibling project**: unit specs sit beside their subject as
`src/**/*.spec.ts`, and the server-dependent suite is `tests/**/*.e2e.spec.ts` driven by
`jest.e2e.config.ts`. `jest.config.ts` ignores `tests/`, so `nx test` and CI's sweep never boot a
server. See #29.

## Schema

Facts live at the lifetime they belong to: `properties`/`units` hold what does **not** change when a
listing does, and `listings` holds one offer. A property is fully meaningful with zero listings.

| Table                 | Notes                                                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `communities`         | Groups properties managed together.                                                                                                          |
| `properties`          | Site facts (parsed address, `geog`, lot, year built, type) **plus dwelling facts when not subdivided**. `address_key` is the dedup identity. |
| `units`               | **Optional** — only for a genuinely subdivided building. A single-family home has zero unit rows.                                            |
| `listings`            | One offer, plus a one-way snapshot of the resolved dwelling facts so search stays a single-table query.                                      |
| `listing_statuses`    | Lookup seeded with the full RESO vocabulary; carries `consumer_status`, `is_terminal`, `counts_toward_dom`.                                  |
| `listing_events`      | Append-only price/status/correction history.                                                                                                 |
| `listing_open_houses` | Multi-occurrence open houses.                                                                                                                |
| `listing_media`       | The gallery, ordered — replaces the old `image_urls text[]`.                                                                                 |
| `listing_search_v`    | Read model that **enforces** the display rules rather than exposing flags for callers to remember.                                           |

`listings` holds the required broker/office attribution block, merchandising flags, the offer
(`offer_kind` plus a generated `listing_type`), ingest identity (`source_system`,
`source_listing_key`), and display-suppression flags. `status` is a foreign key into
`listing_statuses`, not a CHECK. Indexes cover `property_id`, `status`, `(city, state, zip5)`, a
GiST index on `properties.geog`, a GIN index on `amenities`, and a `pg_trgm` GIN index on
`neighborhood` for the fuzzy search #22 will add.

`amenities` is enforced by a **database CHECK** against the fixed 15-value set as well as by
`validateAmenities()` in `src/seed/constants.ts` — a Fair Housing surface is not left to application
code alone. Widening it is a deliberate migration, which is the point.

See the project `CLAUDE.md` for the migration rules and the columns that must never be added.

## Seed data and compliance

`pnpm exec nx run property-service:seed` loads 13 sample listings across 12 properties — two of them
share an address, so the property → many-listings case the schema exists for is actually exercised —
adapted from the web app's mock dataset. This data is **sample data, not real inventory**, and is
authored so that it can never be mistaken for real (PRD §6.2/§6.3):

- `source` is `internal` on every row — never `brightMLS`. This data did not come from the MLS.
- Every `title` ends in `(Sample)`, and every row sets `is_sample = true`, so the labelling reaches
  any client regardless of what it renders.
- Agents are synthetic (`Sample Agent N`) on RFC 2606 reserved `example.com` mailboxes and reserved
  `555-01xx` phone numbers.
- All attribution is to **Real Broker, LLC** (the legal name, per the web app's `brand.ts`).
  Inventing agents at a real competitor's domain would be false attribution to that firm.
- Descriptions carry objective property facts only — no school-quality claims or other Fair Housing
  steering proxies.

`src/seed/mock-listings.spec.ts` enforces each of these against the dataset itself, not just the
transform, because anything importing `mockListings` directly bypasses the transform.

Street addresses and prices stay plausible so search and map rendering get exercised realistically;
the markers above are what keep that plausibility from reading as a real listing.
