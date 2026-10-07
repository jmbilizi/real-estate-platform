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
- **Only a verified code creates an account.** `POST /account/signup/complete` is the only endpoint
  that creates an `ApplicationUser`, and it creates it confirmed. Identity's `/register`,
  `/confirmEmail`, `/resendConfirmationEmail`, `/forgotPassword` and `/resetPassword` do not exist
  (`404`, absent from OpenAPI). Do not add a route that creates a user.
  `Tests/Integration/AccountCreationSurfaceTests.cs` lists every endpoint, fails on an unlisted one,
  probes each with a registration body, and checks that those five paths answer `404`.
- **Identity keeps `login`, `refresh` and `manage/*`.** They stay `MapIdentityApi`'s own handlers.
  `Routes/IdentityEndpoints.cs` maps Identity into a detached route builder and hides the five
  retired routes before the app sees them. Hand-mapping the kept endpoints would copy Identity's
  cookie and bearer handlers. `POST /manage/info` with a new email answers `400`: an email change
  runs by code (see Email change). `POST /manage/info` with a new password runs
  `PasswordChangeService` through `PasswordChangeFilter`, not the framework branch. The current
  password is required and counts toward the lock, and the new stamp ends every other session.
- **The flows are code flows.** Each one sends a 6-digit code by email
  (`Helpers/EmailCodeService.cs`) and answers the same for every address.

  | Flow         | Endpoints                                                      |
  | ------------ | -------------------------------------------------------------- |
  | Sign-up      | `/account/signup/{start,verify,resend,change-email,complete}`  |
  | Sign-in step | `/account/identify`, then `/account/login` or the sign-up flow |
  | Reset        | `/account/password/reset/{start,verify,complete}`              |
  | Email change | `/account/email/change/{start,verify}`                         |
  | Secure       | `POST /account/secure`                                         |

  Each flow has its own section below.

- **Security notices.** After a reset, a password change or an email change,
  `Helpers/SecurityNoticeService.cs` mails the address the account had BEFORE the change. It skips a
  suppressed address, never blocks the action, and logs the kind only. Each notice carries a
  single-use `SecureAccountTokens` token (hash stored, 7 day life) for the "This wasn't me" link.
  The link is `AccountRecovery:WebBaseUrl` + `AccountRecovery:SecureAccountPath`.
- **What this service adds on top of Identity's handlers.** Identity ships `login` with no timing
  equalisation. `Helpers/AccountRecoveryThrottleFilter.cs` is one endpoint filter over the Identity
  group and over every code route. It discriminates on the **bound argument type** (`LoginRequest`,
  `SignUpStartRequest` and so on) rather than the path: `GET /manage/info` has no DTO, so an index-0
  cast would throw there. Policy lives in `Configuration/AccountRecoveryOptions.cs`
  (`AccountRecovery` section). `Models/AppUserManager.cs` reports a soft-deleted account as
  unconfirmed, and `ClearLockoutAsync` releases a lockout after a reset.
- **Every code flow answers the same for registered and unregistered addresses, including the
  timing.** The body parity is in the services. The floor `AccountRecovery:MinimumResponseDuration`
  is in the filter. Anything added to these paths has to keep both. Each flow's test file has the
  parity tests.
- **Mail sends through Postmark.** Sending is queued, not inline: `Helpers/PostmarkDeliveryQueue.cs`
  is both the `IOutboundEmailSender` every composed message goes through and the background service
  that drains it, so no response time depends on Postmark, and no retry blocks a request.
  `PostmarkOptions.IsConfigured` is the fail-closed check: the committed secret placeholder
  (`infra/k8s/base/secrets/postmark.secret.yaml`) reads as "not configured", and the queue discards
  the message with a loud warning (event `1370`) rather than attempting delivery. Accepted, rejected
  and exhausted-retry outcomes log events `1371`/`1372`/`1373`, keyed by `EmailKind`, never the
  code, the link or the body.
- **A soft-deleted account cannot sign in, and the refusal is central.**
  `Models/AppSignInManager.cs` overrides `CanSignInAsync` (every sign-in path) and
  `ValidateSecurityStampAsync` (cookie and `/account/refresh`). Do not move this behind
  `RequireConfirmedAccount`, which is a separate switch. Tests:
  `Tests/Integration/DeletedAccountSignInTests.cs`.
- CPM: versionless `<PackageReference>`; run `pnpm run nx:reset` after project structure changes.

## Identity surface (login, refresh, manage)

- Identity's kept endpoints under `/account` stay the framework's. Do not wrap them. Behaviour
  attaches as filters over the group (`Helpers/AccountRecoveryThrottleFilter.cs`,
  `Helpers/IdentityResponseShapingFilter.cs`) and as options. No setting turns email confirmation on
  or off: every account is born confirmed.
- **Delivery seam**: `Helpers/IOutboundEmailSender.cs` (implemented by `PostmarkDeliveryQueue`) is
  the one transport for the code emails, the notices and the already-registered notice. Every
  message composes through `Helpers/IdentityEmailComposer.cs`. `Helpers/PostmarkEmailSender.cs` is
  the `IEmailSender<ApplicationUser>` that `MapIdentityApi` requires. Every member throws, because
  nothing may send an Identity link or code.
- **Sender identity** (section `Email`): from `Cribstop (Real Broker, LLC) <no-reply@cribstop.com>`,
  reply-to `contact@cribstop.com`. Startup validation refuses a reply-to equal to the from address.
  `Email:BrokerageDisclosure` ends every body (PRD §6). It is configuration, so a jurisdiction
  change needs no code change.
- **Non-enumeration is a product requirement**, not stock Identity. Do not "fix" it back: `/login`
  answers `NotAllowed` and `Lockedout` as `Failed`. `RequiresTwoFactor` stays.
- **Rate limits** live in `Helpers/AccountRecoveryRateLimiter.cs`, consulted before any account
  lookup. Each code flow has a send limit and a verify limit per client address, plus per-email
  limits from the code engine. Caller identity is `X-Real-IP` (see #143). `429` with `Retry-After`.
- Timing floor `AccountRecovery:MinimumResponseDuration` (250ms) applies to `/login` and to every
  code endpoint.
- Tests: `Tests/Integration/IdentityLoginEndpointTests.cs` (login). `AccountRecoveryFactory` gives
  one host per test and records sent messages. The base factory lifts the limits and the floor.
  `AuthHelper.SeedUserAsync` creates a confirmed account for a test.

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

## Contact lookup (#689)

- `POST /internal/account/contacts` (`Routes/ContactLookup.cs`) takes `{ accountIds }` (1 to 100
  UUIDs). It returns `{ contacts: [{ accountId, displayName, email, emailConfirmed }] }`. Unknown
  and soft-deleted ids are omitted. An empty or over-limit batch returns `400`.
- Same trust as introspection: in-cluster only, no gateway route, hidden from OpenAPI. Any hardening
  of introspection (#97) applies here too. The handler never logs an email or a display name.
- Not a directory: no search, no listing.
- Tests: `Tests/Integration/ContactLookupEndpointTests.cs`.

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
  `Helpers/PasswordResetService.cs`.
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

## Email change (#660)

- `POST /account/email/change/{start,verify}`, `Routes/EmailChange.cs`,
  `Helpers/EmailChangeService.cs`. Both need a cookie or bearer session. An API key gets `403`.
- `start` takes `{ newEmail, currentPassword }` or `{ newEmail, oldEmailCode }`. With neither it
  sends an `EmailChangeOld` code to the old address and answers `{ stepUp: "oldEmailCode" }`. A
  wrong password counts toward the Identity lockout (`429` once locked). A wrong old code counts in
  the code engine. Both answer `403 step_up_failed`.
- After step-up, `start` stores one `PendingEmailChanges` row per account (30 minutes). It stores
  the row for a taken address too, and sends the `EmailChangeNew` code only to a free address. A
  taken address, a free address and the caller's own address get the same answer. `verify` counts
  wrong tries for a taken address in the rate limiter (scope `emailchange`), as sign-up does.
- `verify` takes `{ code }`. The swap re-checks the address inside the transaction, then sets email
  and user name, keeps `EmailConfirmed`, rotates the stamp and writes the `AccountSecurityEvents`
  row (`EmailChanged`, keyed hashes of the old and new address) and the `EmailChangeRestores` row.
  The unique index on `NormalizedUserName` is the final guard. A lost race answers
  `400 invalid_code` with no `attemptsLeft`.
- The new stamp ends every other session. The route signs the caller in again, as the same kind of
  session (cookie keeps its persistence, bearer gets a new token body).
- `EmailChangeRestores` holds the old address for 7 days. `POST /account/secure` reads it. #661 owns
  the notice to the old address.

## Secure account (#662)

- `POST /account/secure`, `Routes/SecureAccount.cs`, `Helpers/SecureAccountService.cs`. Anonymous.
  It shares `AccountRecoveryThrottleFilter` (scope `secure`). A bad, used or expired token gives one
  `400 invalid_token`. A GET does nothing.
- One transaction: use the token (`Version` concurrency token, one winner), restore the old email,
  null `PasswordHash`, drop pending email changes, rotate the stamp, write a `SecureAccount` event.
- Restore only for an `EmailChanged` token, an unused `EmailChangeRestores` row of that change that
  has not passed `RestoreUntil`, and an address no other account holds. The check runs inside the
  transaction. A lost race on the user-name index retries the call without the restore.
- No password hash means the owner must set a password by emailed code (#658). The call does not
  send that code. The web page opens the reset flow.
- Purge: `PendingRegistrationPurgeService` also runs `EmailChangeService.PurgeAsync`.
- Data keyed on email (checked for #660): waitlist interests key on `UserId` (FK, composite key).
  API keys and onboarding intents key on `UserId`. Property-service leads (`listing_inquiries`) key
  the account link on `account_id`. Their `email` column is a contact snapshot from the inquiry. It
  stays as it was and does not change with the account. The staff duplicate check groups leads by
  that snapshot, so one person's leads from before and after a change do not merge. Nothing orphans.
  Account-service tables keyed on an address (`EmailCodes`, `EmailCodeThrottles`,
  `PendingRegistrations`) hold short-lived state.
- Known limits: counters are per process. Any signed-in caller can lock the `EmailChangeNew` purpose
  of an address by five wrong tries, which bounds as in sign-up. The in-memory test provider has no
  unique index, so the database guard has no test.
- Tests: `Tests/Integration/EmailChangeEndpointTests.cs`.

## Undeliverable email (#664)

- `EmailSuppressions` holds one row per normalized address that Postmark will not deliver to
  (`HardBounce`, `SpamComplaint`, `ManualSuppression`, `InactiveRecipient`).
  `EmailSuppressionService` is the only writer. Every call is idempotent.
- `POST /account/webhooks/postmark` (`Routes/PostmarkWebhook.cs`) takes the Bounce (`Inactive: true`
  only), SpamComplaint and SubscriptionChange events. `SuppressSending: false` removes the row. It
  needs HTTP Basic credentials: `POSTMARK_WEBHOOK_USER` and `POSTMARK_WEBHOOK_PASSWORD`. Without
  both, every call gets `401`. An event on another message stream is ignored. An event the service
  does not act on gets `200`, so Postmark does not retry it.
- The path is not under `/internal` on purpose. The gateway forbids a route to `/internal`
  (`InternalRoutesNotExposedTests`). Postmark reaches the endpoint through its own gateway route
  (`account-service-routes.json`, 120 per minute). Basic auth is the gate.
- The sign-up paths (`/signup/start`, `/resend`, `/change-email`, `/identify`) answer `422`
  `{ "error": "undeliverable" }` for a suppressed address or a domain with no MX, A or AAAA record.
  Password reset stays neutral. A Postmark `406` on send writes an `InactiveRecipient` row after the
  response, so the next step shows it.
- `DnsMailDomainResolver` (DnsClient) checks the domain. A timeout or DNS error fails open. It does
  not block disposable domains. Tests use `FakeMailDomainResolver` and never query DNS.
- Nothing logs the address or the body.
