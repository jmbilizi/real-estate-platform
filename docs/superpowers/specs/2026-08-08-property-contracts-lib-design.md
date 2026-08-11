# `libs/property-contracts` — design

**Ticket:** [#47](https://github.com/jmbilizi/real-estate-platform/issues/47) · **Blocks:**
[#22](https://github.com/jmbilizi/real-estate-platform/issues/22) (endpoints),
[#24](https://github.com/jmbilizi/real-estate-platform/issues/24) (web app wiring) · **Date:**
2026-08-08

This document records the **design decisions and why they were taken**. The acceptance criteria live
on #47 and are not restated here. Where the two disagree, the ticket wins.

## Problem in one line

Three artefacts must never drift from each other — the runtime validation `property-service` applies
to a search request, the TypeScript types `cribstop-next` renders against, and the OpenAPI document
the gateway aggregates. Today they would be three hand-written things. This package makes them one
definition with three projections.

That matters more than it usually would because the fields most likely to drift are the ones
carrying obligations: NAR 7.58 attribution, seller display-suppression, and PRD §6.3 sample
labelling. A type error is not the failure mode. An attribution field that quietly stops being sent,
and a card that quietly stops rendering it, is.

## Scope

**In:** the Nx library, its workspace/package identity, the request and response schemas, a
type-only conformance file in the web app, and the three build registries that must know the library
exists.

**Out:** every endpoint, all SQL, the gateway route, and serving `/openapi.json`. Those are #22.
This package is imported by nothing at runtime when it lands — deliberately.

## Why this is its own ticket

The seam is deployability. #47 leaves the cluster running with nothing calling the new code; #22 is
when something calls it. Three consequences justify the split:

1. **The Dockerfile trap is front-loaded.** Adding a `libs/` dependency without declaring it in the
   consuming Dockerfiles breaks the image build — and, because `tools/ci/affected-images.js` derives
   the CI image matrix from each Dockerfile's `COPY` sources, also stops the image rebuilding when
   contracts change. Both failures are silent. Discovering them at the end of an XL PR is the worst
   available time.
2. **#24 gets its types before the endpoints exist**, which is the actual schedule win.
3. **The compliance-bearing shape gets reviewed once, on its own**, rather than buried in a diff
   that also contains query builders and route wiring.

## Decisions

### Zod v4 over TypeBox

TypeBox's advantage is that its schemas _are_ JSON Schema, so OpenAPI emission is free. That is the
only axis on which it wins, and it is not the axis that decides this.

**The request contract is not a shape, it is a parser.** Every value arriving in `req.query` is a
string. Unknown parameters must be rejected. `amenities` arrives as either a repeated parameter or a
comma list and must validate against the closed 15-value set that `listings.amenities` already
enforces with a database `CHECK`. Zod does coercion, refinement, unknown-key rejection and typed
error reporting in one declaration. TypeBox needs ajv _plus_ `additionalProperties: false` _plus_ a
hand-rolled coercion layer — which puts the contract in a second place, which is the drift this
package exists to prevent.

Zod v4 ships `z.toJSONSchema()` in core, so there is **no converter package** — one less dependency
that can lag the schema library and mis-emit silently. It is emitted with `target: "openapi-3.0"`,
which renders `.nullable()` as `nullable: true` rather than the default draft-2020-12
`anyOf: [{…}, {type: "null"}]`. This contract is nullable-heavy by design, so the 3.0 form is
markedly more legible in the gateway's aggregated Swagger UI. (The gateway handles either: MMLib
already aggregates `multi-model-inference`'s FastAPI-generated 3.1 document today.)

**Known sharp edge:** `z.toJSONSchema()` cannot represent a `.transform()`, and a coerced primitive
has an `unknown` input type that renders as an empty `{}` under `io: "input"`. So numeric query
parameters are authored as `z.string().regex(…).transform(Number)` rather than `z.coerce.number()`,
which keeps the published spec meaningful for those fields. The emitted document is pinned by a
golden-file snapshot test, so any drift in Zod's emitter lands in a reviewable diff instead of in
the gateway's Swagger UI.

### No discriminated union for sold rows

Modelling `closePrice`/`closeDate` behind a discriminant on `status` would make TypeScript _narrow
them away_ on non-sold rows. That is the opposite of the nullable-always-present rule the rest of
the contract follows. They are `number | null` / `string | null`, always present.

### Nullable-always-present, never omitted, never sentinels

A `0` for a land parcel's `beds` asserts a fact that is false (PRD §6.3) and corrupts range
predicates. Omission is indistinguishable from `null` to a JSON client and lets the TypeScript type
lie. So every field that can legitimately be absent is `T | null` with the key always present.

`price` is nullable **despite `list_price` being `NOT NULL` in the database**. Bright announced
seller-directed field-level suppression — price, address, photos, days on market, price history — on
2026-07-09. A required non-null `price` means the first suppressed-price listing either breaks the
client or forces publication of a value the seller opted out of. Nullable now is free.

### No field-selection parameter, anywhere

There is deliberately no sparse-fieldset or `fields=` parameter in the schema, and unknown query
parameters are rejected. This is the only durable guarantee that a caller cannot strip attribution:
it is a structural prohibition rather than a rule someone must remember. It also kills the
silent-typo'd-filter class of bug, where `?bed=3` is ignored and the user is shown unfiltered
results.

### `description` on detail only

No card renders it; it is ~1KB of prose per row on a response intended to be publicly cacheable; and
it is the single field carrying the Fair Housing steering risk. It does not belong on the widest,
most-cached surface. It remains `string | null` on detail.

### The compile-error test must not drag #24 into #47

The naive reading — "make `cribstop-next` import the contract's `Listing`" — pulls all of #24 into
this ticket. The contract's `sqft` is `number | null`, so `ListingCard.tsx`'s unguarded
`sqft.toLocaleString()` stops compiling; there is no `imageUrls`; there is no `isSaved`; and
`officeBrokerLeadMail` is renamed. Every one of those is #24's work.

Instead, `apps/clients/cribstop/next/src/lib/contracts.check.ts` is a **type-only** conformance file
using an `Equals`/`Expect` pair to assert the contract's key sets. It emits no runtime code, touches
no component, and fails `nx type-check cribstop-next` naming the exact field when the contract
changes. It also hands #24 a literal checklist of what to reconcile.

The demonstration belongs in the PR body: flip one field name in the library, paste the type-check
failure.

### No `tsconfig` `paths` entry

The repo resolves through TS-solution-style project references plus pnpm workspace symlinks; the
root `tsconfig.json` has its `paths` block commented out and `@nx/js/typescript` configured in
`nx.json`. `apps/clients/cribstop/next/tsconfig.json` does not extend the root and has its own `@/*`
alias. Adding a second alias there produces a resolution path that satisfies `tsc` and then fails at
webpack bundle time. The dependency is declared as `workspace:*` in both consumers and pnpm does the
rest.

### `--linter=none` on the generator

Load-bearing, not a preference. The default `--linter=eslint` emits a **new root
`eslint.config.mjs`**, which does not exist today; this repo lints via
`eslint --config tools/node/configs/eslint.config.js`. Letting the generator drop that file changes
flat-config resolution repo-wide.

## Components

| Unit                                                    | Purpose                                                         | Depends on |
| ------------------------------------------------------- | --------------------------------------------------------------- | ---------- |
| `libs/property-contracts/src/search-request.ts`         | Strict, coercing query schema                                   | zod        |
| `libs/property-contracts/src/listing-card.ts`           | Flat list row + envelope (`total`, page info, `appliedFilters`) | zod        |
| `libs/property-contracts/src/listing-detail.ts`         | Nested `{ property, unit, listing }`; `unit` nullable           | zod        |
| `libs/property-contracts/src/listings-meta.ts`          | Dataset-freshness shape                                         | zod        |
| `libs/property-contracts/src/errors.ts`                 | The one 400 body and the one 404 body                           | zod        |
| `libs/property-contracts/src/openapi.ts`                | `toOpenApiDocument()`                                           | the above  |
| `apps/clients/cribstop/next/src/lib/contracts.check.ts` | Type-only conformance assertions                                | types only |

Each file is one shape group, readable without reading its siblings. `openapi.ts` is the only module
that knows about JSON Schema.

## Data flow

None at runtime in this ticket. The output is a compile-time coupling (TypeScript project references
plus the conformance file) and a build-time coupling (Dockerfile `COPY` declarations feeding the CI
image matrix).

## Error handling

The only runtime behaviour defined here is the shape of failure: a strict-parse rejection produces
the single documented 400 body, and the single 404 body is defined here so #22 can guarantee that an
unknown ID, a soft-deleted ID and a display-suppressed ID are byte-identical. An opted-out listing
must be indistinguishable from one that never existed — a distinct status or body would be a
confirmation oracle.

## Testing

| Assertion                                                          | Where                                                           |
| ------------------------------------------------------------------ | --------------------------------------------------------------- |
| Emitted OpenAPI document is stable                                 | Golden-file snapshot in `libs/property-contracts`               |
| Unknown query parameter rejected                                   | Schema unit test                                                |
| `amenities` limited to the closed 15-value set                     | Schema unit test                                                |
| Numeric coercion from string query values                          | Schema unit test                                                |
| No `hasOpenHouse`, no `imageUrls`, no field-selection param exists | Schema unit test asserting key sets                             |
| Contract change breaks the web app's type-check                    | `contracts.check.ts` + a deliberate rename, evidenced in the PR |
| Both images rebuild on a lib-only change                           | `affected-images.js --explain`                                  |
| Cluster still healthy with the lib as a declared dependency        | `skaffold:services:deploy` exits 0                              |

## Risks

**The pruned production install.** `property-service`'s `prune` target chains
`@nx/js:prune-lockfile` and `@nx/js:copy-workspace-modules`. Both are no-ops today because no
workspace dependency exists; adding one makes them do real work, and the Dockerfile's
`pnpm --dir dist/… install --prod --frozen-lockfile` must resolve `@cribstop/property-contracts`
against whatever `prune-lockfile` rewrote it to. Declaring it in `dependencies` is the honest
declaration and is tried first. If that install fails, the fallback is `devDependencies` — webpack
bundles the library into `main.js`, so nothing resolves it at runtime. The verification is
`skaffold:services:deploy`, not `nx build`.

**`cribstop-next` is on Alpine**, which is the pre-existing latent musl/DNS issue recorded in the
root `CLAUDE.md`. If the `next build` fails here, the cause is the missing
`libs/property-contracts/node_modules` copy, not the base image. Do not "fix" it by switching bases.

**Getting the `libs/` pattern wrong costs five times.** `libs/` is empty today and four more Node
services will copy whatever this establishes.
