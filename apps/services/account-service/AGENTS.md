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
- **Account recovery is `MapIdentityApi`'s, not ours — this service adds no endpoints to it.**
  `/account/register`, `/account/confirmEmail`, `/account/resendConfirmationEmail`,
  `/account/forgotPassword`, `/account/resetPassword`. A previous round built a bespoke pair at
  `/account/password/{forgot,reset}` and suppressed Identity's; a stakeholder ruling overturned that
  (#136) — Identity's email-confirmation gate is a requirement to implement confirmation, not a
  reason to route around Identity.
- **Never remove, rename or filter out an Identity endpoint, and `/account/confirmEmail` least of
  all.** `MapIdentityApi` captures its endpoint name (`MapIdentityApi-/account/confirmEmail`, as
  `EndpointNameMetadata`) and both `/register` and `/resendConfirmationEmail` build their
  confirmation link from it via `LinkGenerator.GetUriByName`. Take it out and `/register` throws
  `NotSupportedException` **after** `CreateAsync` has committed the row — a 500 against an account
  that exists and can never be confirmed.
- **What this service adds on top of Identity's handlers, and where.** Identity ships these
  endpoints with **no rate limiting and no timing equalisation** at all. Both are reattached by
  `Helpers/AccountRecoveryThrottleFilter.cs`, one endpoint filter over the whole group, which
  discriminates on the **bound argument type** (`ForgotPasswordRequest` etc.) rather than the path —
  `GET /confirmEmail` has no DTO, so an index-0 cast would throw there. Policy lives in
  `Configuration/AccountRecoveryOptions.cs` (`AccountRecovery` section). `Models/AppUserManager.cs`
  carries the two things a filter cannot do, because it runs before the account is known: clearing a
  lockout after a successful reset (Identity's `ResetPasswordAsync` leaves `LockoutEnd` alone, so
  the spraying that locked an account would outlast recovery from it), and reporting a soft-deleted
  account as unconfirmed — the one predicate Identity consults on `/forgotPassword`,
  `/resetPassword` and `CanSignInAsync` alike.
- **The forgot and resend responses are identical for registered and unregistered addresses
  including their timing.** The body parity is Identity's; the floor is ours. Anything added to that
  path has to preserve it, and the parity tests in
  `Tests/Integration/AccountRecoveryEndpointTests.cs` (forgot) and
  `Tests/Integration/EmailConfirmationEndpointTests.cs` (resend) are there to catch it if not.
- **No mail is sent here, and without a registration none would be sent _silently_.** Identity's
  `AddApiEndpoints()` `TryAdd`s `DefaultMessageEmailSender` → `NoOpEmailSender`, which discards
  every confirmation link and reset code with a `200` and no log line — which is what this service
  did until #136. `Helpers/UndeliveredIdentityEmailSender.cs` stands in and logs a warning per
  message (event id 1360 reset, 1361 confirmation), never the link or the code. Delivery (#138) is
  one DI registration; no contract changes.
- **`AccountRecovery:RequireConfirmedEmail` is `false` on purpose.** Turning it on with no mail
  provider (#133) would mean nobody can create a usable account. #149 owns the flip; both states are
  already tested. Read the remarks on the property before changing it — it is not a revocation, and
  it creates an enumeration oracle on `/account/login`.
- **Password reset** (#136) runs on the same rate limiter, options section and delivery seam as
  confirmation. `/forgotPassword` and `/resetPassword` are metered separately from resend and
  registration (`RequestsPerEmail`, `RequestsPerAddress`, `RedemptionsPerAddress`), and
  `/forgotPassword` is held to the same timing floor. `/forgotPassword` issues nothing for an
  unconfirmed address — Identity gates it on `IsEmailConfirmedAsync` — so until #149 turns
  enforcement on, an account created before this shipped gets no reset token until its owner
  confirms through `/resendConfirmationEmail`. Tests:
  `Tests/Integration/AccountRecoveryEndpointTests.cs`.
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
  Register: per client address. Password reset: per email address and per client address for the
  request, per client address for redemption. Caller identity is `X-Real-IP` (see #143). `429` with
  `Retry-After`.
- Timing floor `AccountRecovery:MinimumResponseDuration` (250ms) applies to `/register`,
  `/resendConfirmationEmail` and `/forgotPassword`.
- Tests: `Tests/Integration/EmailConfirmationEndpointTests.cs` (register, confirm, resend, login)
  and `Tests/Integration/AccountRecoveryEndpointTests.cs` (password reset). Both use
  `AccountRecoveryFactory` (one host per test, records sent messages). The base factory lifts the
  limits and the floor.
