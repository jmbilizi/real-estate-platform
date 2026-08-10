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
- `next/src/lib/listings.ts` — **mock data** for listings/services/community, clearly labeled as
  sample.
- `next/src/lib/contracts.check.ts` — a **type-only** conformance file against
  `@cribstop/property-contracts` (`libs/property-contracts`), the single definition of the listings
  wire contract. It emits no runtime code and touches no component. If a contract change breaks
  `pnpm exec nx type-check cribstop-next` here, reconcile the rendering code to the new contract
  rather than editing these assertions to match — the assertions are what caught the drift.
  Reconciling the UI with the real contract is ticket #24.
- `next/src/app/api/account/*` — **real backend** (login/logout/profile/session/ signup) via the API
  gateway. Do not break this wiring; do not wire mock domains to live backends unless the task
  explicitly says to.
- The app README says "static JSON only" — **stale** on the auth point; trust the code.

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
