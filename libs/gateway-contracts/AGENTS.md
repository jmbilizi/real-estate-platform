# gateway-contracts (`@cribstop/gateway-contracts`)

The error contract for responses the API gateway itself emits, never a downstream service. Nx
project name: **`@cribstop/gateway-contracts`** — identical to the npm package name, for the same
reason as `libs/property-contracts` (see its `AGENTS.md` "Rules" section): `@nx/js:prune-lockfile`
on Nx 22.0.1 looks up a workspace dependency by package name in a map keyed by project name, and a
mismatch silently drops the library's own dependencies from a consumer's pruned lockfile.

## Why this is not part of `property-contracts`

`property-contracts` describes what `property-service` promises. A gateway-enforced response —
Ocelot's own 429 rate limit, or `UpstreamUnavailableMiddleware`'s 502/503 — is not that service's
claim to make, and fires on account and inference routes too. #52's code review raised putting
`upstream_unavailable` in `property-contracts`; the engineer declined for this reason, and #177
gives the gateway's own responses their own home instead of widening a per-service contract to cover
something it does not own.

## What belongs here

- The gateway's own error codes (`upstream_unavailable`, `rate_limited`) and the Zod schema/types
  derived from them.
- Nothing service-specific. If a code only ever comes from one downstream service, it belongs in
  that service's own contract package, not here.

## The account/inference divergence (#177 AC5)

`property-service` sends `{ "error": { "code", "message" } }` — the same shape this package uses.
`account-service` sends `{ "error": "<string>" }`. `multi-model-inference` sends FastAPI's
`{ "detail": "<string>" }`. This package does not converge them: normalizing a service's own error
envelope is that service's change to make, not a consequence of documenting what the gateway itself
sends. The divergence is recorded here, not resolved, because #177 is scoped to gateway-emitted
responses only.

## The no-`paths`-entry rule

Same rule as `property-contracts`: resolution is pnpm `workspace:*` plus TypeScript project
references. A `paths` alias resolves for `tsc` and then fails at bundle time. The `@nx/js:lib`
generator writes one into the root `tsconfig.json` on every run; delete it, don't build on it.

## Commands

```bash
pnpm exec nx build @cribstop/gateway-contracts        # tsc build (@nx/js:tsc)
pnpm exec nx test @cribstop/gateway-contracts         # Jest
pnpm exec nx lint @cribstop/gateway-contracts
pnpm exec nx type-check @cribstop/gateway-contracts   # tsc -b -- follows project references
pnpm exec nx format @cribstop/gateway-contracts       # also: format-check
```
