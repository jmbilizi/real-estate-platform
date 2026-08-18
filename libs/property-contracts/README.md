# property-contracts (`@cribstop/property-contracts`)

The single definition of the listings wire contract (PRD §3.1). One set of Zod schemas, from which
runtime request validation, the TypeScript types the web app renders against, and the OpenAPI
document the gateway aggregates are all derived — so none of the three can drift from the others.

Consumed via pnpm workspaces: declare `"@cribstop/property-contracts": "workspace:*"` in a
consumer's `package.json`. Never add a `tsconfig` `paths` entry for it.

See `AGENTS.md` in this directory for what belongs here, the structural prohibitions the schemas
enforce, and why the Nx project name is scoped to match the npm package name.

## Commands

Always use the `pnpm exec nx` wrapper rather than a bare `nx` — repo rule, for consistent tool
resolution and cross-platform behaviour.

```bash
pnpm exec nx build @cribstop/property-contracts        # tsc build (@nx/js:tsc)
pnpm exec nx test @cribstop/property-contracts         # Jest
pnpm exec nx lint @cribstop/property-contracts
pnpm exec nx type-check @cribstop/property-contracts
pnpm exec nx format @cribstop/property-contracts       # also: format-check
```
