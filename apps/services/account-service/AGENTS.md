# Account Service (account-service)

ASP.NET Core Minimal APIs + ASP.NET Identity + PostgreSQL/EF Core — identity, auth, RBAC, API keys,
audited profiles for the whole platform. Nx project name: **`account-service`**. See its `README.md`
for service-specific detail.

## Commands

```bash
pnpm run account:serve                 # nx serve account-service
pnpm exec nx test account-service      # Runs companion Tests/ project
pnpm exec nx build account-service     # Also: lint, type-check, format
```

## Notes

- Endpoints live in `Routes/` (Minimal APIs), EF Core migrations in `Migrations/`, entities in
  `Models/`, DTOs in `Dtos/`.
- Tests use the **companion `Tests/` subfolder convention** (`.Tests.csproj` inside this project
  dir, not a separate Nx project) — see root `AGENTS.md` § .NET Companion Test Convention.
- Auth schemes (PRD §11.1): cookie (`Identity.Application`), opaque bearer (`Identity.Bearer`, **not
  JWT**), and SHA-256-hashed API keys.
- Six-tier staff RBAC is hierarchical; **domain roles are additive facets** — never model them as
  exclusive personas (PRD §11.2).
- CPM: versionless `<PackageReference>`; run `pnpm run nx:reset` after project structure changes.

## Identity surface (register, confirm, resend, reset)

- Identity's own endpoints under `/account` are the whole surface. Do not add, suppress or wrap
  them. `/register` builds its link from the endpoint name on `/confirmEmail`. Behaviour attaches as
  filters over the group (`Helpers/AccountRecoveryThrottleFilter.cs`,
  `Helpers/IdentityResponseShapingFilter.cs`) and as options.
- **Switch**: `AccountRecovery:RequireConfirmedEmail` binds to
  `SignInOptions.RequireConfirmedAccount`. It is **OFF in every environment**, set explicitly in
  each overlay (`AccountRecovery__RequireConfirmedEmail`). The service logs event `1364` at startup
  while it is off. #149 turns it on. Until then an unconfirmed account can sign in and
  `/forgotPassword` issues nothing for it. This is a known half-state, not a bug.
- **Delivery seam**: one `IEmailSender<ApplicationUser>`. Today it is
  `Helpers/UndeliveredIdentityEmailSender.cs`, which logs events `1360`/`1361` and never logs the
  link or code. #138 swaps in the Postmark transport. Every sender composes through
  `Helpers/IdentityEmailComposer.cs`.
- **Sender identity** (stakeholder ruling 2026-09-16, section `Email`): from
  `Cribstop (Real Broker, LLC) <no-reply@cribstop.com>`, reply-to `contact@cribstop.com`. Startup
  validation refuses a reply-to equal to the from address. `Email:BrokerageDisclosure` ends every
  body (PRD §6). It is configuration, so a jurisdiction change needs no code change.
- **Confirmation link**: `AccountRecovery:WebBaseUrl` + `AccountRecovery:ConfirmationPath`
  (`/confirm-email`, fixed) + Identity's `userId` and `code`. `Helpers/ConfirmationLinkBuilder.cs`
  rebuilds Identity's in-cluster link onto the web origin. `WebBaseUrl` has no default in code. Each
  overlay sets `AccountRecovery__WebBaseUrl`; the deploy action substitutes
  `CRIBSTOP_DOMAIN_PLACEHOLDER`.
- **Non-enumeration is a product requirement**, not stock Identity. Do not "fix" it back:
  - `/register` with an address already in use answers the success response (`200`, empty body). An
    unconfirmed account gets a fresh link through the seam. A confirmed account is logged (event
    `1362`). Password-policy and malformed-address failures still return `400`.
  - `/login` answers `NotAllowed` and `Lockedout` as `Failed`. `RequiresTwoFactor` stays.
  - `/confirmEmail` failures answer one `401` problem body that says to request a new link.
  - `/resendConfirmationEmail` answers `200` for unknown, unconfirmed and confirmed addresses.
- **Rate limits** live in `Helpers/AccountRecoveryRateLimiter.cs`, consulted before any account
  lookup. Resend: 60s interval, 3 per hour, 10 per 24h per address, plus per client address.
  Register: per client address. Caller identity is `X-Real-IP` (see #143). `429` with `Retry-After`.
- Timing floor `AccountRecovery:MinimumResponseDuration` (250ms) applies to `/register` and
  `/resendConfirmationEmail`.
- Tests: `Tests/Integration/EmailConfirmationEndpointTests.cs`. Use `AccountRecoveryFactory` (one
  host per test, records sent messages). The base factory lifts the limits and the floor.
