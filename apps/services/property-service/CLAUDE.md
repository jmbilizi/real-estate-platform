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

## Database

Owns `property_db`, which the Postgres StatefulSet provisions along with `property_service_db_user`
and the `uuid-ossp` / `postgis` / `pg_trgm` / `btree_gist` extensions — see
`infra/k8s/base/configmaps/postgres.configmap.yaml`. This service does **not** create the database;
it only owns the schema inside it.

- **Local**: copy `.env.example` to `.env` and set `DATABASE_URL`. Migrations run via the `migrate`
  target, which uses `--envPath .env`.
- **In-cluster**: `DATABASE_URL` is assembled in the Deployment from `postgres-svc` plus the
  `PROPERTY_SERVICE_DB_USER_PASSWORD` key of `postgres-secret`. Migrations run in a **`migrate`
  initContainer** using the same image, invoking `node-pg-migrate` directly — deliberately with no
  `--envPath`, because containers get env vars, not a `.env` file.
- Migrations are plain CommonJS in `migrations/` and are **not** part of the webpack bundle, so the
  Dockerfile copies that directory into the runtime image explicitly. If you move it, the
  initContainer silently has nothing to apply.

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
