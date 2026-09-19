# gateway-contracts (`@cribstop/gateway-contracts`)

The single definition of the responses the API gateway itself emits: 429, 502 and 503. One Zod
schema, so a client can tell "the gateway itself failed" apart from a downstream service's own error
body.

Consumed via pnpm workspaces: declare `"@cribstop/gateway-contracts": "workspace:*"` in a consumer's
`package.json`. Never add a `tsconfig` `paths` entry for it.

See `AGENTS.md` in this directory for scope and the account/inference divergence this package
records rather than resolves.

## Commands

Always use the `pnpm exec nx` wrapper rather than a bare `nx` — repo rule, for consistent tool
resolution and cross-platform behaviour.

```bash
pnpm exec nx build @cribstop/gateway-contracts        # tsc build (@nx/js:tsc)
pnpm exec nx test @cribstop/gateway-contracts         # Jest
pnpm exec nx lint @cribstop/gateway-contracts
pnpm exec nx type-check @cribstop/gateway-contracts
pnpm exec nx format @cribstop/gateway-contracts       # also: format-check
```
