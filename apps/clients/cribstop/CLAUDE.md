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
- `next/src/app/api/account/*` — **real backend** (login/logout/profile/session/ signup) via the API
  gateway. Do not break this wiring; do not wire mock domains to live backends unless the task
  explicitly says to.
- The app README says "static JSON only" — **stale** on the auth point; trust the code.

## Rules

- Airbnb-quality polish; mobile-first; accessible (labels, alt text, focus states, semantic HTML).
- All listing/marketing microcopy must be Fair-Housing compliant and attribute Real Broker, LLC
  (most prominent brand per Bright MLS rule).
- Follow existing component patterns and Tailwind config; no new dependencies unless clearly
  necessary.
