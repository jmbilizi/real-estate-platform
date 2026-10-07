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
- **Mail sends through Postmark** (#138). Identity's `AddApiEndpoints()` `TryAdd`s
  `DefaultMessageEmailSender` → `NoOpEmailSender`, which discards every message with a `200` and no
  log line; `Helpers/PostmarkEmailSender.cs` replaces it. Sending is queued, not inline:
  `Helpers/PostmarkDeliveryQueue.cs` is both the `IOutboundEmailSender` every composed message goes
  through and the background service that drains it, so no Identity handler's response time depends
  on Postmark, and no retry blocks a request. `PostmarkOptions.IsConfigured` is the fail-closed
  check: the committed secret placeholder (`infra/k8s/base/secrets/postmark.secret.yaml`) reads as
  "not configured", and the queue discards the message with a loud warning (event `1370`) rather
  than attempting delivery. Accepted, rejected and exhausted-retry outcomes log events
  `1371`/`1372`/`1373`, keyed by `EmailKind`, never the link, the code or the body.
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
- **A soft-deleted account cannot sign in, and the refusal is central** (#152).
  `Models/AppSignInManager.cs` overrides `CanSignInAsync` (every sign-in path) and
  `ValidateSecurityStampAsync` (cookie and `/account/refresh`). `AppUserManager.ConfirmEmailAsync`
  refuses it too. Do not move this behind `RequireConfirmedAccount`, which is a separate switch.
  Tests: `Tests/Integration/DeletedAccountSignInTests.cs`.
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
- **Delivery seam**: `Helpers/PostmarkEmailSender.cs` is the `IEmailSender<ApplicationUser>`
  registration; `Helpers/IOutboundEmailSender.cs` (implemented by `PostmarkDeliveryQueue`) is the
  one transport underneath it, used by both the three Identity sends and the already-registered
  notice below. Every message composes through `Helpers/IdentityEmailComposer.cs`, which also builds
  the password-reset link (`Helpers/PasswordResetLinkBuilder.cs`) and states each message's real
  configured token lifetime.
- **Sender identity** (stakeholder ruling 2026-09-16, section `Email`): from
  `Cribstop (Real Broker, LLC) <no-reply@cribstop.com>`, reply-to `contact@cribstop.com`. Startup
  validation refuses a reply-to equal to the from address. `Email:BrokerageDisclosure` ends every
  body (PRD §6). It is configuration, so a jurisdiction change needs no code change.
- **Confirmation link**: `AccountRecovery:WebBaseUrl` + `AccountRecovery:ConfirmationPath`
  (`/confirm-email`, fixed) + Identity's `userId` and `code`. `Helpers/ConfirmationLinkBuilder.cs`
  rebuilds Identity's in-cluster link onto the web origin. `WebBaseUrl` has no default in code. Each
  overlay sets `AccountRecovery__WebBaseUrl`; the deploy action substitutes
  `CRIBSTOP_DOMAIN_PLACEHOLDER`.
- **Password-reset link**: `AccountRecovery:WebBaseUrl` + `AccountRecovery:PasswordResetPath`
  (`/reset-password`, fixed — the web app's route, #137) + the email address and the reset code.
  `MapIdentityApi`'s `/forgotPassword` calls only `SendPasswordResetCodeAsync` with a bare code,
  never a URL, so `Helpers/PasswordResetLinkBuilder.cs` builds the link from scratch rather than
  rebuilding one Identity generated.
- **Non-enumeration is a product requirement**, not stock Identity. Do not "fix" it back:
  - `/register` with an address already in use answers the success response (`200`, empty body). An
    unconfirmed account gets a fresh confirmation link through the seam; a confirmed account gets an
    already-registered notice by mail instead (event `1362`), never a different API response.
    Password-policy and malformed-address failures still return `400`.
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

## Email code engine (#650)

- `Helpers/EmailCodeService.cs` issues, verifies and voids 6-digit codes. No endpoint calls it yet.
  Purposes: `EmailCodePurpose` (`SignUp`, `PasswordReset`, `EmailChangeNew`, `EmailChangeOld`).
  Policy: `Configuration/EmailCodeOptions.cs` (`EmailCodes` section).
- Tables: `EmailCodes` (keyed HMAC of the code, never the code) and `EmailCodeThrottles` (wrong
  tries and lock per email and purpose). The throttle row is separate so a resend does not reset it.
- Resend caps count `EmailCodes` rows. The purge keeps a spent row for 24 hours for that reason.
- Limits return a result with `RetryAfterSeconds`, never an exception. A caller maps them to `429`.
- The HMAC key is `EMAIL_CODE_HMAC_KEY` (flat env var). With no usable key, every call returns
  `Unavailable` and startup logs event `1380`. Only Development and Testing use a fixed dev key.
- The code message logs by `EmailKind` only. `PostmarkDeliveryQueue` redacts the recipient for it.
- A striped in-process lock serializes one email and purpose. Two replicas can still race.

## Staff roles (#628)

- `Agent` is a role facet, never a persona. Introspection returns `roles` (array), `email` and
  `emailConfirmed` only when `isValid` is true. `/internal/*` has no gateway route. The gateway test
  `InternalRoutesNotExposedTests` guards it.
- Every grant and removal in `Routes/Admin.cs` writes a `RoleGrantAudits` row. The README says how a
  human grants the first `SuperAdmin`.
