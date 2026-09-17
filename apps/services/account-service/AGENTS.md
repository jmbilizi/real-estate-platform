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
  `Tests/Integration/AccountRecoveryEndpointTests.cs` are there to catch it if not.
- **No mail is sent here, and without a registration none would be sent _silently_.** Identity's
  `AddApiEndpoints()` `TryAdd`s `DefaultMessageEmailSender` → `NoOpEmailSender`, which discards
  every confirmation link and reset code with a `200` and no log line — which is what this service
  did until #136. `Helpers/UndeliveredIdentityEmailSender.cs` stands in and logs a warning per
  message (event id 1360 reset, 1361 confirmation), never the link or the code. Delivery (#138) is
  one DI registration; no contract changes.
- **`AccountRecovery:RequireConfirmedEmailToSignIn` is `false` on purpose.** Turning it on with no
  mail provider (#133) would mean nobody can create a usable account. #138 owns the flip; both
  states are already tested. Read the remarks on the property before changing it — it is not a
  revocation, and it creates an enumeration oracle on `/account/login`.
- CPM: versionless `<PackageReference>`; run `pnpm run nx:reset` after project structure changes.
