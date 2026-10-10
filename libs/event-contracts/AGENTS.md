# event-contracts (`@cribstop/event-contracts`)

The versioned event envelope and JSON Schemas for the Redis Streams bus (PRD 2.3). The Nx project
name equals the npm package name, as in `libs/property-contracts`. This is a library. Nothing serves
it.

## What this package is

- JSON Schema files in `src/schemas/<type>.v<version>.json` are the source of truth. One file per
  event type and version. Each file holds the whole envelope, so a .NET service reads one file with
  no `$ref` resolution.
- `parseEvent(input)` validates an event against the schema for its own `type` and `version`. It
  uses Ajv (draft 2020-12). Unknown extra fields pass, because evolution is additive.
- `registry.ts` maps each type and version to its schema file. Add a row for each new schema file. A
  test fails when a schema file is not registered.
- `streamFor(type)` gives `events.<aggregate>`. `dlqFor(type)` gives `events-dlq.<aggregate>`.
- `toStreamFields(event)` gives the Redis entry fields: `envelope` (the JSON string), `type`, `id`.
  `fromStreamFields(fields)` reads them back through `parseEvent`.

## Rules

- **Never edit a released schema in a breaking way.** A breaking change is a removed field, a
  narrowed type or limit, a removed enum value, or a newly required field. Add a new version file
  (`<type>.v2.json`) instead.
- **Release a schema by copying it to `compat/baseline/`.** `breakingChanges()` compares each file
  in `src/schemas/` with its baseline. The test fails on a breaking change and on a schema without a
  baseline.
- `data` is a flat string map: max 20 keys, 256 characters per value. A value never holds an email
  address or a phone number. A key is never `email`, `phone`, `message` or a similar name. The
  schemas enforce this, so a .NET consumer gets the same checks.
- `recipient` holds an account id only.
- The envelope `id` is set once by the producer and equals the outbox row id.
- Security events use category `transactional` only.
- Pure code only: no I/O, no clock, no `process.env`, no Redis client.
- Never add a `tsconfig` `paths` entry. Consumers declare
  `"@cribstop/event-contracts": "workspace:*"` and the repo registers the package in
  `pnpm-workspace.yaml`. See `libs/property-contracts/AGENTS.md`.
- A consuming Dockerfile must copy this package path, so the image rebuilds when a schema changes.

## Commands

```bash
pnpm exec nx test @cribstop/event-contracts
pnpm exec nx lint @cribstop/event-contracts
pnpm exec nx type-check @cribstop/event-contracts
pnpm exec nx build @cribstop/event-contracts
```
