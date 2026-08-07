# property-service

Node.js + Express service owning the property domain: the **Communities → Properties → Units →
Listings** hierarchy (PRD §3) and the consumer listing model (PRD §3.1).

Backed by the `property_db` PostgreSQL database, which infra already provisions with `uuid-ossp`,
`postgis`, `pg_trgm`, and `btree_gist` (`infra/k8s/base/configmaps/postgres.configmap.yaml`).

> **Scope today.** This project currently ships the schema, migrations, a seed dataset, and
> `GET /health` only. The search/detail REST API is #22; saved/favorited listings are #23. Property
> relationship claims (PRD §3.2) are not modelled yet.

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
