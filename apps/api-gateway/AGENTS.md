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
applies none of it**, with no error: every configured timeout falls back to Ocelot's 90-second
default handler timeout, and there is no breaker at all. Never remove that call.

Use the current property names. Ocelot 24.1 still honours `TimeoutValue`,
`ExceptionsAllowedBeforeBreaking` and `DurationOfBreak`, but marks them obsolete and removes them in
25.0:

| Current             | Obsolete                          | Unit         |
| ------------------- | --------------------------------- | ------------ |
| `Timeout`           | `TimeoutValue`                    | milliseconds |
| `MinimumThroughput` | `ExceptionsAllowedBeforeBreaking` | failures     |
| `BreakDuration`     | `DurationOfBreak`                 | milliseconds |

`GlobalConfiguration.QoSOptions` in `Configuration/Ocelot.Settings.json` holds `FailureRatio` and a
conservative fallback for every property. Ocelot merges it into a route **property by property**,
and the route wins. So a route file added later with no `QoSOptions` still gets a timeout and a
breaker. Do not re-list `FailureRatio` per route.

**`SamplingDuration` must hold `MinimumThroughput` failures end to end.** Polly counts failures
inside that window, and a failing call occupies its whole `Timeout`. A window shorter than
`MinimumThroughput × Timeout` never collects enough of them: the breaker stays closed forever and
every caller pays the full timeout. Such a value still passes Polly's own floors, so nothing reports
it. Keep `SamplingDuration ≥ 1.5 × MinimumThroughput × Timeout`. `RouteQoSOptionsTests` enforces
that for every route and for the global fallback.

| Class            | Routes                                               | `Timeout` | `MinimumThroughput` | `SamplingDuration` | `BreakDuration` |
| ---------------- | ---------------------------------------------------- | --------- | ------------------- | ------------------ | --------------- |
| Fast public read | `/property/listings/meta`, `/property/listings/{id}` | 3000      | 5                   | 30000              | 5000            |
| Public search    | `/property/listings` (exact `COUNT(*)` per search)   | 5000      | 5                   | 45000              | 5000            |
| Auth write       | `/account/*` (password hashing, outbound email)      | 10000     | 4                   | 60000              | 10000           |
| Model inference  | `/inference/embeddings`                              | 30000     | 2                   | 90000              | 15000           |
| Inference read   | `/inference/models`                                  | 5000      | 5                   | 45000              | 10000           |
| Inference probe  | `/inference/health`, `/inference/ready`              | 3000      | 5                   | 30000              | 10000           |

The threshold falls as the timeout rises, for the same reason: two consecutive 30-second timeouts on
an inference call is already an outage, and demanding five would need a three-minute window.

The search timeout is a product judgement, not a measurement: a shopper abandons a search well
before five seconds. Measure the p95 of `/property/listings` against a populated Bright dataset and
revisit this one value alone. Never raise the global fallback to cover one slow route.

**Degraded-response contract.** `Middleware/UpstreamUnavailableMiddleware.cs` replaces Ocelot's
empty error body with the envelope the property surface uses:

```json
{ "error": { "code": "upstream_unavailable", "message": "..." } }
```

The status is the one Ocelot chose: **503** for a timeout or an open breaker, **502** for a
connection that never opened. A client treats `error.code === "upstream_unavailable"` as "retry
later" and tells it apart from a 404 or a validation error by the code alone. Timeout and
breaker-open share one code because Ocelot maps both to `RequestTimedOutError`, and the difference
changes nothing a client can do.

**On a write, `upstream_unavailable` means indeterminate, not "nothing happened".** The gateway
abandons a `/account/register` or `/account/resetPassword` call at 10 seconds; the service may still
commit it. A client that retries blindly gets a duplicate-account error or a consumed-token error
and shows the person the wrong reason. Retry a write only when the operation is idempotent or the
client can check the outcome first.

The three surfaces behind these routes do not share one error envelope. `property-service` uses
`{ "error": { "code", "message" } }`, `account-service` uses `{ "error": "<string>" }`, and the
inference service uses FastAPI's `{ "detail": "<string>" }`. So this body matches the property
surface and adds a third shape on the other two. It costs nothing today, because Ocelot's current
empty body already fails the same client checks, but it is not the same as "one shape everywhere".
Two related gaps sit with it: a 429 still returns `QuotaExceededMessage` as plain text, and
`upstream_unavailable` is in no shared contract package. Tracked in #177.

QoS does not apply to `/swagger/docs/...`. `MMLib.SwaggerForOcelot` fetches each downstream document
with its own `HttpClient`, outside Ocelot's request pipeline.
