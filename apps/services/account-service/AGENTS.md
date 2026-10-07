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
- **Only a verified code creates an account** (#657, stakeholder ruling 2026-10-07). It supersedes
  #136 for register, confirm and resend. `POST /account/signup/complete` is the only endpoint that
  creates an `ApplicationUser`, and it creates it confirmed. `/account/register`,
  `/account/confirmEmail` and `/account/resendConfirmationEmail` do not exist (`404`). Do not add a
  route that creates a user. `Tests/Integration/AccountCreationSurfaceTests.cs` lists every
  endpoint, fails on an unlisted one, and probes each with a registration body.
- **Identity's kept endpoints are still `MapIdentityApi`'s**: `login`, `refresh`, `forgotPassword`,
  `resetPassword`, `manage/*`. #665 retires the link-based reset pair. `Routes/IdentityEndpoints.cs`
  maps Identity into a detached route builder and hides the three retired routes before the app sees
  them, so the kept handlers stay the framework's own. The alternative was hand-mapping the kept
  endpoints, which copies Identity's cookie and bearer handlers. `POST /manage/info` with a new
  email answers `400`: Identity would mail a link built from the retired `/confirmEmail` route.
- **What this service adds on top of Identity's handlers, and where.** Identity ships these
  endpoints with **no rate limiting and no timing equalisation** at all. Both are reattached by
  `Helpers/AccountRecoveryThrottleFilter.cs`, one endpoint filter over the whole group, which
  discriminates on the **bound argument type** (`ForgotPasswordRequest` etc.) rather than the path —
  `GET /manage/info` has no DTO, so an index-0 cast would throw there. Policy lives in
  `Configuration/AccountRecoveryOptions.cs` (`AccountRecovery` section). `Models/AppUserManager.cs`
  carries the two things a filter cannot do, because it runs before the account is known: clearing a
  lockout after a successful reset (Identity's `ResetPasswordAsync` leaves `LockoutEnd` alone, so
  the spraying that locked an account would outlast recovery from it), and reporting a soft-deleted
  account as unconfirmed — the one predicate Identity consults on `/forgotPassword`,
  `/resetPassword` and `CanSignInAsync` alike.
- **The forgot response is identical for registered and unregistered addresses including its
  timing.** The body parity is Identity's; the floor is ours. Anything added to that path has to
  preserve it. The parity tests in `Tests/Integration/AccountRecoveryEndpointTests.cs` catch a
  break.
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
- **Password reset** (#136) runs on the same rate limiter, options section and delivery seam as the
  code flows. `/forgotPassword` and `/resetPassword` are metered by `RequestsPerEmail`,
  `RequestsPerAddress` and `RedemptionsPerAddress`, and `/forgotPassword` is held to the timing
  floor. Tests: `Tests/Integration/AccountRecoveryEndpointTests.cs`.
- **A soft-deleted account cannot sign in, and the refusal is central** (#152).
  `Models/AppSignInManager.cs` overrides `CanSignInAsync` (every sign-in path) and
  `ValidateSecurityStampAsync` (cookie and `/account/refresh`). Do not move this behind
  `RequireConfirmedAccount`, which is a separate switch. Tests:
  `Tests/Integration/DeletedAccountSignInTests.cs`.
- CPM: versionless `<PackageReference>`; run `pnpm run nx:reset` after project structure changes.

## Identity surface (login, refresh, reset)

- Identity's kept endpoints under `/account` stay the framework's. Do not wrap them. Behaviour
  attaches as filters over the group (`Helpers/AccountRecoveryThrottleFilter.cs`,
  `Helpers/IdentityResponseShapingFilter.cs`) and as options. No setting turns email confirmation on
  or off: every account is born confirmed (#149 declined as moot).
- **Delivery seam**: `Helpers/PostmarkEmailSender.cs` is the `IEmailSender<ApplicationUser>`
  registration. `SendConfirmationLinkAsync` throws, because nothing may send a confirmation link.
  `Helpers/IOutboundEmailSender.cs` (implemented by `PostmarkDeliveryQueue`) is the one transport
  underneath it, used by the Identity reset sends, the already-registered notice and the code
  emails. Every message composes through `Helpers/IdentityEmailComposer.cs`, which also builds the
  password-reset link (`Helpers/PasswordResetLinkBuilder.cs`) and states each message's real
  configured token lifetime.
- **Sender identity** (stakeholder ruling 2026-09-16, section `Email`): from
  `Cribstop (Real Broker, LLC) <no-reply@cribstop.com>`, reply-to `contact@cribstop.com`. Startup
  validation refuses a reply-to equal to the from address. `Email:BrokerageDisclosure` ends every
  body (PRD §6). It is configuration, so a jurisdiction change needs no code change.
- **Password-reset link**: `AccountRecovery:WebBaseUrl` + `AccountRecovery:PasswordResetPath`
  (`/reset-password`, fixed — the web app's route, #137) + the email address and the reset code.
  `MapIdentityApi`'s `/forgotPassword` calls only `SendPasswordResetCodeAsync` with a bare code,
  never a URL, so `Helpers/PasswordResetLinkBuilder.cs` builds the link from scratch. `WebBaseUrl`
  has no default in code. Each overlay sets `AccountRecovery__WebBaseUrl`; the deploy action
  substitutes `CRIBSTOP_DOMAIN_PLACEHOLDER`. #665 removes this link.
- **Non-enumeration is a product requirement**, not stock Identity. Do not "fix" it back:
  - `/login` answers `NotAllowed` and `Lockedout` as `Failed`. `RequiresTwoFactor` stays.
  - `/forgotPassword` answers `200` for every address.
- **Rate limits** live in `Helpers/AccountRecoveryRateLimiter.cs`, consulted before any account
  lookup. Password reset: per email address and per client address for the request, per client
  address for redemption. Caller identity is `X-Real-IP` (see #143). `429` with `Retry-After`.
- Timing floor `AccountRecovery:MinimumResponseDuration` (250ms) applies to `/login` and
  `/forgotPassword`.
- Tests: `Tests/Integration/IdentityLoginEndpointTests.cs` (login) and
  `Tests/Integration/AccountRecoveryEndpointTests.cs` (password reset). Both use
  `AccountRecoveryFactory` (one host per test, records sent messages). The base factory lifts the
  limits and the floor. `AuthHelper.SeedUserAsync` creates a confirmed account for a test, because
  `/register` is gone.

## Email code engine (#650)

- `Helpers/EmailCodeService.cs` issues, verifies and voids 6-digit codes. Sign-up calls it (see
  Sign-up below). Purposes: `EmailCodePurpose` (`SignUp`, `PasswordReset`, `EmailChangeNew`,
  `EmailChangeOld`). Policy: `Configuration/EmailCodeOptions.cs` (`EmailCodes` section).
- Tables: `EmailCodes` (keyed HMAC of the code, never the code) and `EmailCodeThrottles` (wrong
  tries and lock per email and purpose). The throttle row is separate so a resend does not reset it.
- Resend caps count `EmailCodes` rows. The purge keeps a spent row for 24 hours for that reason.
- Limits return a result with `RetryAfterSeconds`, never an exception. A caller maps them to `429`.
- The HMAC key is `EMAIL_CODE_HMAC_KEY` (flat env var). With no usable key, every call returns
  `Unavailable` and startup logs event `1380`. Only Development and Testing use a fixed dev key.
- The code message logs by `EmailKind` only. `PostmarkDeliveryQueue` redacts the recipient for it.
- A striped in-process lock serializes one email and purpose. Two replicas can still race.

## Sign-up before an account exists (#652)

- Endpoints (anonymous, `Routes/SignUp.cs`): `POST /account/signup/start`, `/verify`, `/resend`,
  `/change-email`. The gateway catch-all `/account/{everything}` already routes them.
- Logic is in `Helpers/SignUpService.cs`. A pending sign-up is a `PendingRegistrations` row: no
  password, no `ApplicationUser`, expiry 30 minutes after the last code (`SignUp` options section).
  `PendingRegistrationPurgeService` deletes expired rows. #654 creates the account.
- `/verify` returns `signupProof`: 32 random bytes, stored only as a SHA-256 hash on the row, 15
  minute life, bound to the email. `SignUpService.TryConsumeProofAsync` uses it up once. #654 must
  call it before it creates the account.
- Wrong code: `400` with `attemptsLeft`. Lock or limit: `429` with `Retry-After`. No engine key:
  `503`.
- **Same answer for every address.** `/start` for an address with an account sends the
  already-registered notice and answers like a new address. `/resend` and `/verify` do nothing for
  an address with no open sign-up. The engine counts no wrong try without an open code, so
  `AccountRecoveryRateLimiter.TryDecoyWrongTry` counts it in memory: the same tries left, then the
  same lock. Do not remove it. Without it, `attemptsLeft` tells an existing address from a new one.
- **Limits** run in `AccountRecoveryThrottleFilter`, before any lookup. Send (start, resend, new
  address of a change): per client address, plus per email cooldown, hour and day from `EmailCodes`.
  Verify: per client address, which caps how many emails one address can lock. Change-email also
  counts the old email. The address counter runs first, so an exhausted address cannot spend a
  victim's email budget. The timing floor `AccountRecovery:MinimumResponseDuration` applies to all
  four endpoints.
- A row with a live, unused proof is protected. `/start` leaves it alone and `/change-email` does
  not drop it. Without this, anyone who knows the address could void the owner's proof.
- Known limits: counters are per process (see the limiter). Anyone who knows an address that waits
  for a code can drop it with `/change-email`, or lock it with five wrong tries. Both are bounded by
  the limits above. After a lock, `/start` answers `429` for a new address and for an existing one
  alike. In every deployed environment the engine answers `503` until #669 supplies
  `EMAIL_CODE_HMAC_KEY`.
- Email key: trim and upper case only. Plus tags and dots stay (`Helpers/SignUpEmail.cs`).
- Tests: `Tests/Integration/SignUpEndpointTests.cs`. Gateway: `AccountSignUpRoutesTests`.

## Identify (#653)

- `POST /account/identify` (anonymous, `Routes/Identify.cs`, logic in `Helpers/IdentifyService.cs`)
  answers `{ next, resendAfterSeconds, expiresInSeconds }`. A confirmed, active account gets
  `next: "password"` with both numbers `0`. Every other valid address gets `next: "code"` after
  `SignUpService.StartAsync`. Bad address: `400`. No engine key: `503`.
- **Decision (stakeholder default, #653): the route is revealed.** The route is the only thing the
  endpoint reveals. Both routes have one JSON shape and run under the timing floor. A cooldown or
  lock in the code engine answers `next: "code"` with the wait in `resendAfterSeconds`, not `429`.
  So a pending, locked or undeliverable address looks like a new one. The service has no suppression
  store, so there is no `undeliverable` answer. Do not add one.
- Soft-deleted and unconfirmed accounts get `code`. `/start` sends them the already-registered
  notice, not a code, so an unconfirmed account has no way forward from identify (known gap). #654
  refuses a soft-deleted account at the set-password step.
- The code route spends the `/signup/start` send budget (`TrySignUpSend`) before it calls
  `StartAsync`. A refusal there answers `code` with the wait and the full code life, not `429`.
- The per-email limit counts every route, so anyone can make one address answer `429` for the
  window. The ticket requires it.
- No engine key: `503` for every address, so the status shows no route.
- **Limits** (`AccountRecovery:IdentifiesPerAddress` 20, `IdentifiesPerEmail` 5, per
  `RequestWindow`): `AccountRecoveryRateLimiter.TryIdentify`, in the throttle filter. The address
  counter runs first. A bad address counts against the address only. `429` with `Retry-After`.
- Bot challenge (Turnstile) is not built. Add it if the logs show identify abuse: sustained `429`
  from many client addresses.
- Tests: `Tests/Integration/IdentifyEndpointTests.cs`.

## Staff roles (#628)

- `Agent` is a role facet, never a persona. Introspection returns `roles` (array), `email` and
  `emailConfirmed` only when `isValid` is true. `/internal/*` has no gateway route. The gateway test
  `InternalRoutesNotExposedTests` guards it.
- Every grant and removal in `Routes/Admin.cs` writes a `RoleGrantAudits` row. The README says how a
  human grants the first `SuperAdmin`.

## Complete sign-up and password policy (#654)

- `POST /account/signup/complete` (`Routes/SignUpComplete.cs`, `Helpers/SignUpCompletion.cs`) takes
  `{ email, signupProof, password }`. It uses up the proof, creates a confirmed `ApplicationUser`
  through `UserManager.CreateAsync` (default role, password check), deletes the pending row, and
  signs in like `/login`. Query `useCookies` and `useSessionCookies` pick cookie or bearer.
- Answers: `200` session, `401 invalid_proof`, `400 password_rejected` with `errors` (stable codes),
  `409 email_unavailable` (an account, a soft-deleted account, or a lost race: one answer).
- A rejected password gives the proof back (`SignUpService.ReleaseProofAsync`). The proof check runs
  first, so the breach check is not an oracle for a caller without a proof.
- The new account, its role and the pending-row delete share one transaction on a relational
  provider. The unique index on `NormalizedUserName` (the address) is the final guard.
- Policy: `Configuration/PasswordPolicyOptions.cs`, section `PasswordPolicy`. `MinLength` 15,
  `MaxLength` 128, no composition rules. `Helpers/PasswordPolicyValidator.cs` is the only
  `IPasswordValidator`, so register, change and reset follow it. Codes: `too_short`, `too_long`,
  `breached`. The password is never trimmed. Old shorter passwords still log in.
- Breach check: `Helpers/PwnedPasswordsClient.cs` (HIBP range API, SHA-1 prefix, `Add-Padding`, 2
  second timeout). A timeout or error lets the password pass and logs event `1390`. The HTTP client
  calls `RemoveAllLoggers()` because the framework logs the request URI, which holds the prefix.
  Never log the password, the hash or the exception text there.
- Tests use `FakePwnedPasswordsClient` (`AccountServiceFactory.Breaches`). No test reaches the API.

## Password reset by code (#658)

- `POST /account/password/reset/{start,verify,complete}`, `Routes/PasswordReset.cs`,
  `Helpers/PasswordResetService.cs`. The link endpoints (`/forgotPassword`, `/resetPassword`) stay
  until #665.
- `start` and `verify` answer the same for every address. Only a confirmed, live account gets a
  `PasswordReset` code. The decoy and send counters use scope `pwreset`, so a reset never spends a
  sign-up counter.
- `verify` returns `resetProof` (single use, 15 minutes). The `PasswordResetProofs` row holds a
  SHA-256 hash and the account id. `complete` uses the proof up first. A refused password gives the
  proof back.
- `complete` takes `{ email, resetProof, newPassword }`. It runs the same validators as sign-up,
  sets the hash, rotates the security stamp (ends every cookie and bearer session), clears the
  lockout and writes an `AccountSecurityEvents` row in one transaction. It signs nobody in: the
  response is `204`, and the client sends the user to sign in.
- `AccountSecurityEvents` is append-only, with no FK to the account. `ClientAddressHash` is an HMAC
  of the client address under the code key, never the address. Tests:
  `Tests/Integration/PasswordResetEndpointTests.cs`.
