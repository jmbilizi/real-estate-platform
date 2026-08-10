# property-contracts (`@cribstop/property-contracts`)

The single definition of the listings wire contract (PRD §3.1). Nx project name:
**`property-contracts`**. Port n/a — this is a library, imported at build time, never served.

**`libs/` was empty before this package landed.** Its shape — targets, tags, `package.json`
identity, workspace registration — is the template the next four Node libraries will copy. Getting
it wrong here costs five times, not once.

## What this package is

One schema definition with three projections derived from it:

1. **Runtime validation** — the exact parsing `property-service` applies to a request.
2. **TypeScript types** — the exact types `cribstop-next` renders against.
3. **OpenAPI** — the document the gateway's `MMLib.SwaggerForOcelot` aggregates.

Today these would be three hand-written things that drift. The fields most likely to drift are the
ones carrying obligations — NAR 7.58 attribution, seller display-suppression, PRD §6.3 sample
labelling — so the failure mode this package exists to prevent is not a type error, it's an
attribution field that quietly stops being sent.

## What belongs here

- Zod schemas (request, response, error shapes) and the types derived from them via `z.infer`.
- The OpenAPI builder (`toOpenApiDocument()`, via Zod v4's built-in `z.toJSONSchema()` — no
  converter package; do not add one).
- Pure, side-effect-free code only. No I/O, no state, no clock, no randomness beyond what a caller
  passes in.

## What does not belong here

- **No SQL.** No `pg`, no query builders, no anything that assumes a database exists.
- **No HTTP.** No `express`, no route handlers, no request/response objects — only the data shapes a
  route would use.
- **No environment access.** No `process.env`, no config loading, no secrets.
- If a file in this package imports `pg` or `express`, that import is the bug, not the file.

This library is imported by nothing at runtime when it lands (#47 is deliberately scoped to stop
short of #22's endpoints). That is expected, not a mistake — verify with `nx build`/`nx type-check`,
not by looking for a caller.

## Structural prohibitions (not conventions — enforced by the shape of the schema)

- **No field-selection parameter, anywhere** (no `fields=`, no sparse fieldset). Unknown query
  parameters are rejected outright. This is the only durable guarantee that a caller cannot strip
  attribution — a structural prohibition, not a rule someone has to remember.
- **No `hasOpenHouse`.** Not a field this contract will ever carry.
- **No `imageUrls`.** Not a field this contract will ever carry.
- **Nullable-always-present, never omitted, never sentinels.** A field that can legitimately be
  absent is `T | null` with the key always present — never dropped from the payload, never a `0` or
  `""` standing in for "unknown". `price` is nullable even though `list_price` is `NOT NULL` in the
  database, because Bright's seller-directed field suppression can withhold it.
- **No discriminated union keyed on `status`.** It would let TypeScript narrow
  `closePrice`/`closeDate` away on non-sold rows, which breaks the nullable-always-present rule.

Any addition to this package should be checked against this list before it is checked against
anything else.

## The no-`paths`-entry rule

**Never add a `tsconfig` `paths` entry for this package, in this repo's root `tsconfig.json` or
anywhere else.** Resolution is pnpm `workspace:*` (declare
`"@cribstop/property-contracts": "workspace:*"` in a consumer's `package.json`) plus TypeScript
project references. A `paths` alias resolves for `tsc` and then fails at webpack bundle time in
`cribstop-next` — it is a trap that looks like it works until a real build is attempted. The
`@nx/js:lib` generator writes a `paths` entry into the root `tsconfig.json` on every run; delete it,
don't build on it.

## Commands

```bash
pnpm exec nx build property-contracts        # tsc build (@nx/js:tsc)
pnpm exec nx test property-contracts         # Jest
pnpm exec nx lint property-contracts
pnpm exec nx type-check property-contracts   # tsc -b -- follows project references; -p would not
pnpm exec nx format property-contracts       # also: format-check
```

## Rules

- Package name `@cribstop/property-contracts`; Nx project name `property-contracts`. Keep these
  distinct — the pnpm package name is scoped, the Nx project name is not.
- Only dependency: `zod` (pinned `^4.4.3`). Do not add a JSON-Schema converter package — Zod v4
  emits `z.toJSONSchema()` natively, target `"openapi-3.0"` for legible `nullable: true` rendering
  instead of the draft-2020-12 `anyOf` form.
- A value with a `.transform()` cannot be represented by `z.toJSONSchema()`; author coerced numeric
  query parameters as `z.string().regex(...).transform(Number)` rather than `z.coerce.number()`, or
  the emitted OpenAPI document renders that field as an empty `{}`.
- `description` belongs on the detail shape only, never the list row — it is the field carrying the
  most Fair Housing steering risk and does not belong on the widest, most-cached surface.
- Any consuming Dockerfile must declare this package's path in its `COPY`/`--mount=type=bind`
  sources. `tools/ci/affected-images.js` derives the CI image-rebuild matrix from those `COPY`
  sources, not from Nx's affected graph — a consumer that depends on this package without copying it
  will build locally and then silently fail to rebuild its image when the contract changes.
