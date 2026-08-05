# listings-service

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
pnpm exec nx serve listings-service          # Run locally (port 3002)
pnpm exec nx test listings-service           # Unit tests — no database required
pnpm exec nx lint listings-service
pnpm exec nx type-check listings-service
pnpm exec nx build listings-service

pnpm exec nx run listings-service:migrate       # Apply migrations (needs DATABASE_URL)
pnpm exec nx run listings-service:migrate-down  # Roll back the last migration
pnpm exec nx run listings-service:seed          # Load the sample dataset

pnpm exec nx e2e listings-service-e2e        # Boots the service, then hits it over HTTP
```

Unit tests mock the `pg` client and never open a connection, so they run anywhere. The `e2e` project
is where anything requiring a live server lives — note its `test` target is a deliberate no-op for
that reason.

## Schema

| Table         | Notes                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------- |
| `communities` | Groups properties managed together.                                                           |
| `properties`  | A building or standalone home; optional `community_id`. `property_type` is CHECK-constrained. |
| `units`       | Optional subdivision of a property (apartment/condo unit).                                    |
| `listings`    | An offer against a property and optionally a unit. Carries the full consumer model.           |

`listings` holds the required broker/office attribution block, merchandising flags (`featured`,
`price_reduced`, `new_construction`, open-house fields), `text[]` image URLs and amenities, and
CHECK constraints on `listing_type`, `source`, and `status`. Indexes cover `property_id`, `status`,
`(city, state, zip)`, and a `pg_trgm` GIN index on `neighborhood` for the fuzzy search #22 will add.

Amenity values are validated in application code against the fixed enum in `src/seed/constants.ts`
rather than by a CHECK constraint, so the vocabulary can evolve without a migration.

## Seed data and compliance

`pnpm exec nx run listings-service:seed` loads 12 sample listings adapted from the web app's mock
dataset. This data is **sample data, not real inventory**, and is authored so that it can never be
mistaken for real (PRD §6.2/§6.3):

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
