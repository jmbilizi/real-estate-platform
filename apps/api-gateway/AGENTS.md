# API Gateway (api-gateway)

Ocelot-based .NET gateway — single entry point routing to internal microservices. Nx project name:
**`api-gateway`**.

## Commands

```bash
pnpm run gateway:serve                 # nx serve api-gateway
pnpm exec nx build api-gateway         # Also: lint, type-check, format
pnpm run nx:dotnet-build               # All .NET projects
```

## Notes

- Auth is **forwarded, not issued here**: cookie / opaque bearer / API key, validated by
  account-service (PRD §11.1). No JWT.
- Swagger aggregation via MMLib.SwaggerForOcelot; routing config lives in `Configuration/`.
- .NET conventions: Central Package Management (`Directory.Packages.props` at repo root) —
  versionless `<PackageReference>`; `.editorconfig` at root drives style; `pnpm run nx:reset` after
  any project add/remove to resync the .sln.
- See `PRD.md` §2 for the gateway's role in the overall architecture.

## Quality of Service (timeouts and circuit breakers)

Every route in `Configuration/Routes/*.json` carries `QoSOptions`. `Startup.cs` calls
`AddOcelot(...).AddPolly()`. **A `QoSOptions` block with no `AddPolly()` registration parses and
does nothing** — no timeout, no breaker, and no error. Never remove that call.

Use the current property names. Ocelot 24.1 still honours `TimeoutValue`,
`ExceptionsAllowedBeforeBreaking` and `DurationOfBreak`, but marks them obsolete and removes them in
25.0:

| Current             | Obsolete                          | Unit         |
| ------------------- | --------------------------------- | ------------ |
| `Timeout`           | `TimeoutValue`                    | milliseconds |
| `MinimumThroughput` | `ExceptionsAllowedBeforeBreaking` | failures     |
| `BreakDuration`     | `DurationOfBreak`                 | milliseconds |

`GlobalConfiguration.QoSOptions` in `Configuration/Ocelot.Settings.json` holds the shared breaker
shape (`FailureRatio`, `SamplingDuration`) and a conservative fallback for every property. Ocelot
merges it into a route **property by property**, and the route wins. So a route file added later
with no `QoSOptions` still gets a timeout and a breaker. Do not re-list `FailureRatio` or
`SamplingDuration` per route.

Timeouts are per route class; the breaker threshold is uniform (`MinimumThroughput: 5` over the
global 30-second window), because five failures in thirty seconds is an outage on any of these
services:

| Class                  | Routes                                               | `Timeout` |
| ---------------------- | ---------------------------------------------------- | --------- |
| Fast public read       | `/property/listings/meta`, `/property/listings/{id}` | 3000      |
| Public search          | `/property/listings` (exact `COUNT(*)` per search)   | 5000      |
| Auth write             | `/account/*` (password hashing, outbound email)      | 10000     |
| Model inference        | `/inference/embeddings`                              | 30000     |
| Inference read / probe | `/inference/models`, `/inference/health`, `/ready`   | 5000/3000 |

**Degraded-response contract.** `Middleware/UpstreamUnavailableMiddleware.cs` replaces Ocelot's
empty error body with the envelope the services already use:

```json
{ "error": { "code": "upstream_unavailable", "message": "..." } }
```

The status is the one Ocelot chose: **503** for a timeout or an open breaker, **502** for a
connection that never opened. A client treats `error.code === "upstream_unavailable"` as "retry
later" and tells it apart from a 404 or a validation error by the code alone. Timeout and
breaker-open share one code because Ocelot maps both to `RequestTimedOutError`, and the difference
changes nothing a client can do.

QoS does not apply to `/swagger/docs/...`. `MMLib.SwaggerForOcelot` fetches each downstream document
with its own `HttpClient`, outside Ocelot's request pipeline.
