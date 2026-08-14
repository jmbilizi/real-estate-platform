# Cribstop Web App (cribstop-next)

Next.js (App Router) consumer app at `next/` — the three-tab experience: Homes, Services, Connect.
Nx project name: **`cribstop-next`**.

## Commands

```bash
pnpm run cribstop:web                  # Dev server with HMR
pnpm run skaffold:services             # Run backend in K8s alongside (2nd terminal)
pnpm exec nx lint cribstop-next        # Also: test, type-check
```

## Key Docs

- `DESIGN.md` (this directory) — design system: tokens, typography, components.
- `PRD.md` (repo root) — §4 information architecture, §6 compliance.

## Structure Notes

- Route groups in `next/src/app`: `(pill-only)`, `(tabs-only)`, `(with-search)` control
  navbar/search variants; `@modal` is a parallel route for modals.
- `next/src/lib/brand.ts` — centralized brand (Real Broker LLC prominence rule); propagate brand
  changes from here only, never hardcode.
- `next/src/lib/types.ts` — **re-exports `@cribstop/property-contracts`; it does not declare listing
  shapes.** Add a field to the contract, never here. Search and detail are two different shapes:
  `ListingCardRow` (flat, what `GET /property/listings` returns) and `ListingDetailView` (the
  flattened form of the nested `{ property, unit, listing }` detail graph, produced by
  `toListingDetailView` in `lib/api/listings.ts`). Never force one to serve both.
- **Lean list, rich detail — the payload split is a design rule, not an accident.** A search or
  home-page request fetches only what a _card_ draws, `primaryMedia` alone rather than the gallery,
  because a results page renders ~20 rows and every added field is paid 20 times. The full graph
  (all media, description, open houses, complete NAR 7.58 attribution) is fetched only when a user
  opens a listing, which is when it is worth paying for. Consequences to respect: never widen
  `ListingCardRow` to spare a detail fetch, never render a card from a detail payload "because we
  have it", and never assume a card row carries a detail-only field — it is absent, not null.
  Opening the same listing twice should still cost one fetch: `lib/api/listings-cache.ts` is a
  per-tab, 5-minute detail cache that exists to make that true. It is **not** the platform's caching
  layer — service-side Redis caching on the Property API is, and is tracked separately; this only
  removes the round trip a warm server cache would still cost.
- `next/src/lib/contracts.check.ts` — a **type-only** conformance file against
  `@cribstop/property-contracts` (`libs/property-contracts`), the single definition of the listings
  wire contract. It emits no runtime code and touches no component. If a contract change breaks
  `pnpm exec nx type-check cribstop-next` here, reconcile the rendering code to the new contract
  rather than editing these assertions to match — the assertions are what caught the drift.
- `next/src/lib/listing-format.ts` — the **only** place a nullable listing field is turned into
  display text. Every compliance rule with a copy consequence lives here exactly once (withheld
  price, lot-size units, the no-bare-comma title fallback, the no-centroid address rule). Format at
  this layer, not at the render site.
- `next/src/app/api/account/*` and `next/src/app/api/listings/*` — **real backend** via the API
  gateway. Account is `/account/*`; listings are `/property/listings`, `/property/listings/meta`,
  `/property/listings/{id}` (the service serves `/listings/*`; Ocelot rewrites — never call the
  service path directly). The browser never talks to the gateway: it calls these route handlers,
  which make the hop server-side via `app/api/_lib/gateway.ts`. Do not break this wiring.
- `next/src/app/api/_lib/listings-query.ts` — the forwardable query-parameter set is **derived from
  the contract's `searchRequestSchema`**, never hand-listed. It is an allowlist on purpose: it is
  what makes "no occupancy value is ever transmitted" (#34) structural instead of a rule someone has
  to remember. Do not replace it with a denylist and do not add a parameter the contract lacks.
- The app README says "static JSON only" — **stale**; trust the code. The mock listings array
  (`lib/listings.ts`) was deleted in #24; listing data comes from the Property API.

## Project Automations

- `/compliance-check` (skill, this project) — audit copy/mock data for Fair Housing,
  brand-prominence, fabricated-data, and disclosure rules before shipping.
- `cribstop-compliance-reviewer` (root agent) — dispatchable parallel compliance review for PR diffs
  touching user-facing content.

## Rules

- Airbnb-quality polish; mobile-first; accessible (labels, alt text, focus states, semantic HTML).
- All listing/marketing microcopy must be Fair-Housing compliant and attribute Real Broker, LLC
  (most prominent brand per Bright MLS rule).
- Follow existing component patterns and Tailwind config; no new dependencies unless clearly
  necessary.
- **Never collect a protected-class signal from the searcher.** The occupancy ("Who") picker was
  removed in #34 (age bands, plus a pets counter labelled "Bringing a service animal?" — age,
  familial status, family responsibilities and disability). Do not reintroduce any of it. The
  `Pet Friendly` **listing** amenity is a listing attribute and is fine; a question about the
  searcher is not.
- **Per-listing compliance is driven off the row, never off a flag.** Provenance follows that row's
  `source` (`brightMLS` → Bright's line, `internal` → ours, `other` → neither) — never a build flag,
  env var or default. `isSample` must be labelled on every surface a sample row appears on (card,
  map popup, detail, modal, carousels), and `sponsored` must be labelled wherever it renders.
- **Site-level** Bright/MLS wording in `Footer.tsx` and `app/(pill-only)/about/page.tsx` is a
  separate matter from per-listing provenance: removing MLS attribution can itself violate IDX
  display rules. That wording is #33's to deliver with broker sign-off — flag it, do not invent
  replacement copy.
- A withheld (`null`) `price` renders "Price withheld at the seller's direction" — never blank,
  never `$0`, never an estimate. A suppressed address (`address`/`latitude`/`longitude` null
  together) renders no address and **never** a city or ZIP centroid; the map legitimately shows
  fewer pins than the result count, and that is explained in copy rather than hidden.
