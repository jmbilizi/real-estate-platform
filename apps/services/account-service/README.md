# Account Service

Manages user identity, authentication, and authorization for the real-estate platform. Built on
ASP.NET Core 10 Minimal APIs with ASP.NET Identity.

## Responsibilities

- User registration, login, and session management
- Role-based access control (RBAC) with a six-tier role hierarchy
- Multi-app user tracking — records which front-end apps each user has accessed
- API key issuance and validation for service-to-service and automation use cases
- Profile management with a full JSON audit trail
- Account soft-delete with immediate session revocation

---

## Authentication Schemes

Three schemes are registered and evaluated in order. The first to succeed wins.

### 1. Cookie (`Identity.Application`)

Used by browser-based clients. Issued by the built-in Identity login endpoint.

```
POST /account/login?useCookies=true
{ "email": "...", "password": "..." }
```

The cookie is `HttpOnly`, `SameSite=Strict`, sliding window (default 14 days). The security stamp
inside the cookie is re-validated against the database **on every request**
(`ValidationInterval = TimeSpan.Zero`), so sessions are revoked instantly when a user soft-deletes
their account.

### 2. Bearer Token (`Identity.Bearer`)

Used by non-browser clients (mobile apps, SPAs that prefer not to use cookies). Issued by the same
login endpoint without the `?useCookies=true` flag.

```
POST /account/login
{ "email": "...", "password": "..." }
→ { "accessToken": "...", "refreshToken": "...", "expiresIn": 3600 }
```

Tokens are opaque (DataProtection-based, not JWT). Refresh via `POST /account/refresh`.

The `Authorization` auth-scheme token is matched **case-insensitively** (`Bearer`, `bearer`,
`BEARER` all work), per RFC 7235 §2.1. The framework's `BearerTokenHandler` matches `"Bearer "` with
`StringComparison.Ordinal`, so `Program.cs` supplies the token via
`BearerTokenEvents.OnMessageReceived` using the shared `BearerTokenHeader` parser. That same parser
backs credential introspection, so what the service accepts and what introspection reports can never
drift apart.

### 3. API Key (`ApiKey`)

Used for service-to-service calls and CI/CD pipelines. Sent in the `X-Api-Key` header.

```
X-Api-Key: rep_abcd1234...
```

The handler looks up the SHA-256 hash of the provided key, loads the owning user's roles, and builds
a `ClaimsPrincipal` identical to a logged-in session. Validation checks:

| Check                                 | Failure response |
| ------------------------------------- | ---------------- |
| Key not found in DB                   | `401`            |
| Key revoked (`RevokedAt` is set)      | `401`            |
| Key expired (`ExpiresAt` in the past) | `401`            |
| Owner account soft-deleted            | `401`            |

API keys are per-user, scoped to an optional `AppId` and optional `Scopes` list. A user may hold a
maximum of **10 active keys**.

---

## Authorization

All endpoints require an authenticated user (`RequireAuthorization()`). The default policy accepts
any of the three schemes above.

### Role Hierarchy

Roles are seeded at startup and are cumulative — higher roles have all the permissions of lower ones
by convention.

| Role         | Description                                                                            |
| ------------ | -------------------------------------------------------------------------------------- |
| `SuperAdmin` | Full platform access including billing and role management                             |
| `Admin`      | User management, content, and platform config. Cannot touch `SuperAdmin`/`Admin` roles |
| `Moderator`  | Content moderation and user suspension. No role management                             |
| `Support`    | Read-only access to user data for dispute handling                                     |
| `Developer`  | Internal engineering access for diagnostics                                            |
| `User`       | Standard platform user (assigned automatically on registration)                        |

Role assignment rules enforced server-side:

- Only `SuperAdmin` can assign or remove `SuperAdmin` and `Admin` roles.
- `Admin` can only assign/remove `Moderator`, `Developer`, `Support`, and `User`.
- A `SuperAdmin` cannot remove their own `SuperAdmin` role (prevents lock-out).
- The last `SuperAdmin` cannot soft-delete their own account.

### App Access Claims (`app_access`)

`UserAppClaimsTransformation` runs on every authenticated request. It reads the `UserApps` table for
the current user and injects one `app_access` claim per app the user has ever logged in from:

```
app_access: cribstop
app_access: admin-portal
```

Downstream services and middleware can check these claims to gate access to app-specific features
without an extra DB call.

---

## Registration and Email Confirmation

Registration, confirmation and resend are ASP.NET Core Identity's own endpoints:

```
POST /account/register                 { "email": "...", "password": "..." }   → 200 (empty)
GET  /account/confirmEmail?userId=&code= → 200 "Thank you for confirming your email."
POST /account/resendConfirmationEmail  { "email": "..." }                      → 200 (empty)
```

`/register` sends a confirmation link through `IEmailSender<ApplicationUser>`. The link points at
the web app: `AccountRecovery:WebBaseUrl` + `/confirm-email` + `userId` + `code`. The link is valid
for `AccountRecovery:ConfirmationTokenLifetime` (24h) on a dedicated token provider.

**Enforcement is off** (`AccountRecovery:RequireConfirmedEmail = false` in every environment). An
unconfirmed account can sign in. The service logs a warning (event 1364) at startup while this is
so. #149 turns it on.

**Mail sends through Postmark.** `PostmarkEmailSender` queues every message onto
`PostmarkDeliveryQueue` (a background service) and returns immediately, so a send never blocks the
request that triggered it. The queue retries a transport failure a bounded number of times, then
logs loudly. If `Postmark:ServerToken` is still the committed placeholder — no real token has been
substituted for this environment — nothing is sent and that is logged (event 1370) rather than
attempted. Accepted, rejected, and exhausted-retry outcomes log events 1371/1372/1373, keyed by
message kind, never the link, the code, or the body.

**Sender identity** (configuration, section `Email`): from
`Cribstop (Real Broker, LLC) <no-reply@cribstop.com>`, reply-to `contact@cribstop.com`. Every body
ends with `Email:BrokerageDisclosure` (PRD §6).

**No account enumeration.** The caller learns nothing about whether an address has an account:

| Request                                             | Response                     |
| --------------------------------------------------- | ---------------------------- |
| `/register`, address already in use                 | `200` empty, same as success |
| `/register`, weak password or malformed address     | `400` validation problem     |
| `/login`, unconfirmed (switch on) or locked out     | `401` `detail: "Failed"`     |
| `/confirmEmail`, expired, used, tampered or unknown | `401` "Request a new link."  |
| `/resendConfirmationEmail`, any address             | `200` empty                  |

`/register` and `/resendConfirmationEmail` answer no faster than
`AccountRecovery:MinimumResponseDuration` (250ms).

**Rate limits** (`429` + `Retry-After`, counted before any account lookup):

| Limit                                       | Setting                                   | Default |
| ------------------------------------------- | ----------------------------------------- | ------- |
| Resend interval per address                 | `AccountRecovery:ResendMinimumInterval`   | 60s     |
| Resends per address per hour                | `AccountRecovery:ResendsPerEmailPerHour`  | 3       |
| Resends per address per 24h                 | `AccountRecovery:ResendsPerEmailPerDay`   | 10      |
| Resends per client address per window       | `AccountRecovery:ResendsPerAddress`       | 10      |
| Registrations per client address per window | `AccountRecovery:RegistrationsPerAddress` | 30      |
| Window for the client-address counters      | `AccountRecovery:RequestWindow`           | 15m     |

Client identity is `X-Real-IP`, which the gateway sets. Counters are per process.

---

## Multi-App Tracking

The platform runs multiple front-end apps (`cribstop`, `admin-portal`, etc.). The allowed set is
configured in `appsettings.json`:

```json
"Apps": {
  "AllowedApps": ["cribstop", "admin-portal"]
}
```

When a user authenticates, the `X-App-Id` request header (added by Ocelot) is checked against
`AllowedApps`. If valid, an **atomic upsert** is run against the `UserApps` table:

```sql
INSERT INTO "UserApps" ("UserId", "AppId", "FirstSeenAt", "LastSeenAt")
VALUES (@userId, @appId, NOW(), NOW())
ON CONFLICT ("UserId", "AppId") DO UPDATE SET "LastSeenAt" = NOW()
```

The composite primary key `(UserId, AppId)` ensures no duplicate rows even under concurrent logins.
The `LastLoginAt` field on `ApplicationUser` is updated on every login regardless of app.

---

## Session Revocation

When an account is soft-deleted (`DELETE /account/profile`), the service:

1. Sets `DeletedAt` and `DeletedByUserId` on the user row.
2. Calls `UpdateSecurityStampAsync` to rotate the stored security stamp.

Because `ValidationInterval = TimeSpan.Zero`, the next request carrying that user's **cookie** is
rejected with `401` immediately — there is no expiry window — and their **refresh tokens** are dead,
since `/account/refresh` revalidates the stamp before issuing anything.

An `Identity.Bearer` **access** token already in circulation is the exception: `BearerTokenHandler`
unprotects the ticket and checks its own `ExpiresUtc`, and never re-reads the security stamp. So a
bearer token issued before the revocation keeps working until it expires on its own. This applies to
every stamp rotation in the service — soft-delete, admin suspension, and password reset alike.
Tracked in issue #142.

---

## API Endpoints

### Identity (built-in ASP.NET Identity)

| Method | Path                               | Description                      |
| ------ | ---------------------------------- | -------------------------------- |
| `POST` | `/account/register`                | Register a new account           |
| `POST` | `/account/login`                   | Login — returns bearer token     |
| `POST` | `/account/login?useCookies=true`   | Login — sets auth cookie         |
| `POST` | `/account/refresh`                 | Refresh a bearer token           |
| `POST` | `/account/logout`                  | Logout (revokes cookie/token)    |
| `GET`  | `/account/confirmEmail`            | Confirm email address            |
| `POST` | `/account/resendConfirmationEmail` | Resend the confirmation link     |
| `POST` | `/account/forgotPassword`          | Request a password reset token   |
| `POST` | `/account/resetPassword`           | Redeem a reset token             |
| `POST` | `/account/manage/2fa`              | Manage two-factor authentication |

### Account Recovery

**These endpoints are Identity's own; this service adds none of its own to the recovery surface.**
An earlier round built a bespoke pair at `/account/password/{forgot,reset}` and suppressed
Identity's; a stakeholder ruling overturned that (#136). Identity's email-confirmation gate is a
requirement to implement confirmation, not a reason to route around Identity.

```jsonc
// POST /account/register                 -> 200, 400 (ValidationProblem), or 429 with Retry-After
{ "email": "someone@example.com", "password": "..." }

// POST /account/resendConfirmationEmail  -> 200 (always), or 429 with Retry-After
{ "email": "someone@example.com" }

// GET  /account/confirmEmail?userId=&code=   -> 200 text/plain, or 401

// POST /account/forgotPassword           -> 200 (always), or 429 with Retry-After
{ "email": "someone@example.com" }

// POST /account/resetPassword            -> 200, 400 (ValidationProblem), or 429 with Retry-After
{ "email": "someone@example.com", "resetCode": "<code>", "newPassword": "..." }
```

#### Non-enumeration

`/forgotPassword` and `/resendConfirmationEmail` answer **identically** — status, body, and elapsed
time down to a configured floor — whether or not the address has an account. The body parity is
Identity's own (its handlers return `TypedResults.Ok()` unconditionally); the timing floor is this
service's, because Identity does nothing about timing and the branch that finds an account does a
database hit, a token generation and a send while the branch that does not does almost none of that.
Both halves are explicit tests rather than implementation notes.

`/resetPassword` collapses unknown address, unconfirmed address, tampered token and malformed code
into one indistinguishable `400` (`{"errors":{"InvalidToken":[...]}}`); a password that fails the
policy is reported as itself, but only after the token has proven valid. `/confirmEmail` is keyed on
an opaque `userId` rather than an address and answers a bare `401` for both an unknown user and a
bad code.

**`/register` used to be the exception.** Identity itself returns `400` with
`{"errors":{"DuplicateUserName":[...]}}` for an address that exists and an empty `200` for one that
does not, disclosing membership with no way out from inside the framework.
`Helpers/IdentityResponseShapingFilter.cs` closes that gap (#147): a duplicate address now answers
the identical `200` empty body. What happened is told only to the mailbox — an unconfirmed account
gets a fresh confirmation link, a confirmed account gets an already-registered notice (#138) — never
the caller.

#### Tokens, and what a reset invalidates

Reset tokens come from Identity's `GeneratePasswordResetTokenAsync` on a dedicated provider
(`PasswordResetTokenProvider`) with its own lifetime and its own data-protection purpose, so the
reset lifetime is independent of the **email-confirmation** and two-factor tokens — which matters
now that confirmation exists, where before it was theoretical. Redeeming a token rotates the
account's security stamp, which is part of the token's own payload; that is what makes it
single-use. A successful reset also clears any lockout, so the password spraying that prompted a
reset does not outlast the recovery from it — Identity's `ResetPasswordAsync` leaves `LockoutEnd`
alone, so that part is ours (`Models/AppUserManager.cs`).

Rotating the stamp drops the account's **cookie sessions** on their next request and invalidates its
**refresh tokens** immediately (`/account/refresh` revalidates the stamp before issuing anything).
One residue survives: an `Identity.Bearer` **access** token already issued is self-contained and is
checked only against its own expiry, so it keeps working until it expires on its own. That gap is
service-wide — `DELETE /account/profile` claims the same immediate revocation and has the same hole
— and is tracked separately rather than papered over here.

A **soft-deleted** account is not recoverable and says so by saying nothing: it gets the same `200`
as an address that never existed, and any token already issued for it gets the same opaque `400` as
any other unusable one.

#### Rate limiting

Identity ships these endpoints with **no rate limiting of any kind** — no throttling metadata
anywhere in `MapIdentityApi`'s group; the only brute-force control is its lockout on `/login`. So
registration, reset requests, reset redemptions and confirmation resends are all unmetered out of
the box, which for the three that send mail is an unmetered mail cannon and for redemption is
unmetered token guessing.

`Helpers/AccountRecoveryThrottleFilter.cs` reattaches limits per email address and per client
address, in-process, on top of the gateway's per-route Ocelot limits
(`apps/api-gateway/Configuration/Routes/account-service-routes.json`). The client address comes from
the forwarded `X-Real-IP` header, the same header Ocelot's own limits key on — never the transport
peer, which for every external caller is the gateway pod and would collapse the per-caller limit
into one global bucket. That header is caller-asserted and therefore evadable — the same weakness
the gateway's own limits have; issue #143 tracks making it trustworthy. The per-email limits do not
depend on the caller's claim about who they are.

`/resendConfirmationEmail` is worth calling out: Identity does not gate it on
`IsEmailConfirmedAsync` at all, so it mails a live confirmation link to any registered address,
already confirmed or not, and the address is chosen entirely by the caller.

#### Delivery

**Nothing here sends mail, and without an explicit registration nothing would say so.** Identity's
`AddApiEndpoints()` `TryAdd`s `DefaultMessageEmailSender` over `NoOpEmailSender`, whose
`SendEmailAsync` returns `Task.CompletedTask` — so a service registering neither discards every
confirmation link and reset code with a `200`, no exception and no log line. This service did
exactly that until #136.

`Helpers/PostmarkEmailSender.cs` registers as that `IEmailSender<ApplicationUser>` and composes
through `Helpers/IdentityEmailComposer.cs`, then hands the message to
`Helpers/PostmarkDeliveryQueue.cs` (the `IOutboundEmailSender` transport, also a background service)
rather than sending inline. The link, the code, and the message body are never logged — only the
recipient, the message kind, and the provider's own outcome (accepted, rejected, or failed after
retries).

#### Requiring a confirmed address

`AccountRecovery:RequireConfirmedEmail` drives `SignInOptions.RequireConfirmedAccount` and is
**`false`**. That is deliberate and temporary: Identity issues its confirmation link through the
sender above, and until #133 provisions a transactional provider nothing can deliver it — so
requiring confirmation today would mean nobody can create a usable account at all. #149 owns the
flip, and both states are already covered by tests, so it is a configuration change rather than a
code change.

Two things the flag does not do. It is **not a revocation**: `/account/refresh` checks only the
refresh token's own expiry and the security stamp, never `CanSignInAsync`, so an already-issued
refresh token keeps minting access tokens until its own expiry or a stamp rotation. And it **creates
an enumeration oracle on `/login`**: `PreSignInCheck` returns `NotAllowed` before the password is
verified and Identity puts `result.ToString()` into the problem `detail`, so an unknown address
answers `"Failed"` and a registered-but-unconfirmed one answers `"NotAllowed"` for any password at
all. Raised on #136 for a product ruling.

**Accounts that predate confirmation are deliberately not grandfathered** (product ruling on #147).
No migration marks an existing account confirmed, and no admin force-confirm endpoint exists — that
escape hatch would outlive the need and become a credential-adjacent backdoor. Nothing in this
service has ever written `EmailConfirmed`, so every account created before confirmation shipped has
it `false`, and the consequence is concrete: **`/forgotPassword` answers `200` and issues nothing
for those accounts** until their owner confirms through `/resendConfirmationEmail` like any other
consumer. That is the intended path, not an oversight.

### Profile

| Method   | Path                        | Auth required          | Description                                   |
| -------- | --------------------------- | ---------------------- | --------------------------------------------- |
| `GET`    | `/account/profile`          | Self                   | Get own profile                               |
| `PUT`    | `/account/profile`          | Self                   | Update profile fields (patched, not replaced) |
| `DELETE` | `/account/profile`          | Self                   | Soft-delete account + revoke session          |
| `GET`    | `/account/{userId}/history` | Self / Admin / Support | Profile change history (audit chain)          |

### Admin

| Method   | Path                             | Auth required             | Description           |
| -------- | -------------------------------- | ------------------------- | --------------------- |
| `GET`    | `/account/{userId}/roles`        | Self / Admin / SuperAdmin | List roles for a user |
| `POST`   | `/account/{userId}/roles`        | Admin / SuperAdmin        | Assign a role         |
| `DELETE` | `/account/{userId}/roles/{role}` | Admin / SuperAdmin        | Remove a role         |

### API Keys

| Method   | Path                     | Auth required | Description                                             |
| -------- | ------------------------ | ------------- | ------------------------------------------------------- |
| `POST`   | `/account/api-keys`      | Self          | Create an API key (raw key returned once)               |
| `GET`    | `/account/api-keys`      | Self          | List own API keys (prefix visible, hash never returned) |
| `DELETE` | `/account/api-keys/{id}` | Self          | Revoke an API key                                       |

### Waitlist (early-access interest)

Services and Connect ship as gated preview. These endpoints record which pillars an account wants
early access to. They grant no access and commit to no date.

| Method   | Path                           | Auth required | Description                                 |
| -------- | ------------------------------ | ------------- | ------------------------------------------- |
| `GET`    | `/account/waitlist`            | Self          | List own early-access interests             |
| `POST`   | `/account/waitlist`            | Self          | Register one interest (idempotent)          |
| `DELETE` | `/account/waitlist/{interest}` | Self          | Withdraw one interest (absent is a success) |

Valid `interest` values: `services-consumer`, `services-provider`, `connect`. An account may hold
any combination of them. The account id always comes from the authenticated principal, so a caller
reaches only its own rows.

`POST` rejects a value outside the vocabulary with `400`. `DELETE` does not check the vocabulary:
the lookup is already scoped to the caller, so an unknown value removes nothing and reports the same
success as an absent one. That keeps a row withdrawable after its kind leaves the vocabulary.

```jsonc
// POST /account/waitlist — the interest kind is the entire payload
{ "interest": "connect" }

// GET /account/waitlist
{ "interests": [{ "interest": "connect", "registeredAt": "2026-09-19T05:12:35Z" }] }
```

### Internal Credential Introspection (service-to-service)

| Method | Path                           | Auth shape (forwarded as-is)                          | Description                                                         |
| ------ | ------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------- |
| `POST` | `/internal/account/introspect` | `Cookie`, `Authorization: Bearer ...`, or `X-Api-Key` | Resolves forwarded credentials to `accountId` + validity flags only |

Resolves a credential the gateway forwarded verbatim to the account it belongs to. Response body:

```json
{
  "isValid": true,
  "credentialType": "cookie",
  "accountId": "9f3c…",
  "isRevoked": false,
  "isExpired": false
}
```

`credentialType` is one of `cookie`, `bearer`, `apiKey`, or `none`. `accountId` is `null` whenever
`isValid` is `false`. There is deliberately **no** role or `user_type` field — accounts are
multi-role (PRD §11.2) and identity resolution must not invent a persona. An unparseable or unknown
credential is a definitive `200` negative, never a `500`.

**Multiple credentials.** Shapes are tried in the order API key → bearer → cookie and the **first
one that resolves wins**; the endpoint does not stop at the highest-precedence shape present. This
mirrors how account-service authorizes its own endpoints (the default policy lists all three
schemes), so a stale `Authorization` header travelling alongside a live session cookie cannot
silently defeat the cookie. When nothing resolves, the highest-precedence shape that was present
supplies the reported `credentialType` and flags.

**How the flags are derived.** `isRevoked` and `isExpired` are computed from typed checks, never
from framework failure messages: the ticket is unprotected with the scheme's own protector,
`ExpiresUtc` supplies `isExpired`, and the security stamp — re-read from the database on every call,
because `ValidationInterval = TimeSpan.Zero` — supplies `isRevoked`. API keys share
`ApiKeyValidation` with the authentication handler, so both agree on why a key was rejected.

**Not consumer-facing.** Two separate properties, both required:

- _Unreachable_ — the gateway's broadest route is `/account/{everything}`, so `/internal/**` has no
  public route, and `account-service-svc` is a ClusterIP Service with no Ingress.
- _Unadvertised_ — the endpoint is `ExcludeFromDescription()`, because the OpenAPI document is
  aggregated into the gateway's publicly served Swagger UI.

There is deliberately **no** caller authentication, rate limiting, or NetworkPolicy today: the AC
permits an unrouted path as the mechanism, a shared secret would need provisioning in three
environments before any caller exists to use it, and NetworkPolicy enforcement differs between the
local Kind cluster (not enforced) and k3s (enforced), so one shipped now could not be verified where
it is developed. Defence in depth belongs with the first real caller (#23).

**Caller guidance.**

- Cache semantics are explicit: the endpoint sets `Cache-Control: no-store, no-cache, max-age=0`. On
  a cookie-carrying request the cookie handler overwrites this with its own `no-cache,no-store` when
  it renews the session, so the exact string varies — `no-store` is always present, which is the
  part that matters. Any caller-side caching defeats the immediate revocation this endpoint exists
  to provide.
- Discard the response headers. `UseAuthentication()` authenticates the cookie scheme on every
  request to every endpoint, and with `ValidationInterval = TimeSpan.Zero` the security-stamp
  validator re-signs the principal in — so a cookie-carrying introspection response also carries a
  refreshed `Set-Cookie` for the end user. Never relay or persist it.
- Introspection does not update an API key's `LastUsedAt`; only calls to account-service's own
  endpoints do. Resolution is a read.

### Health

| Method | Path                    | Description     |
| ------ | ----------------------- | --------------- |
| `GET`  | `/account/health`       | Liveness probe  |
| `GET`  | `/account/health/ready` | Readiness probe |

---

## Data Models

### `ApplicationUser` (extends `IdentityUser`)

Key additions on top of the standard Identity columns:

| Field                                                                                                | Purpose                                                                                                                        |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `FirstName`, `LastName`, `MiddleName`, `DisplayName`                                                 | Name fields                                                                                                                    |
| `Bio`, `DateOfBirth`                                                                                 | Personal                                                                                                                       |
| `ProfileImageId`, `CoverImageId`                                                                     | Media references                                                                                                               |
| `VerifiedAt`, `VerifiedByUserId`, `VerificationNote`                                                 | KYC / account verification                                                                                                     |
| `AccountStatusId`                                                                                    | FK → `AccountStatuses` lookup (Active, Suspended, etc.)                                                                        |
| `LastLoginAt`                                                                                        | Updated by `AppSignInManager` on every login                                                                                   |
| `PreferredLocaleId`                                                                                  | FK → `Locales` lookup                                                                                                          |
| `EmailNotificationsEnabled`, `SmsNotificationsEnabled`, `PushNotificationsEnabled`, `MarketingOptIn` | Communication preferences                                                                                                      |
| `Intents`                                                                                            | Self-declared onboarding intents (PRD §4.4) — multi-select, changeable at any time, defaults to `[]` (see `OnboardingIntents`) |
| `PreviousState`                                                                                      | JSON audit chain — each `PUT /profile` pushes the previous state here                                                          |
| `CreatedAt`, `UpdatedAt`, `DeletedAt`                                                                | Timestamps                                                                                                                     |
| `CreatedByUserId`, `UpdatedByUserId`, `DeletedByUserId`                                              | Audit actor FKs                                                                                                                |

### `ApiKey`

| Field                                  | Purpose                                                                          |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| `Prefix`                               | Visible identifier (e.g. `rep_abcd1234`) — safe to display in listings           |
| `KeyHash`                              | SHA-256 of the raw key — only thing stored, raw key never persisted              |
| `AppId`                                | Optional — scopes the key to one app                                             |
| `Scopes`                               | Optional — space-separated permission list (e.g. `listings:read listings:write`) |
| `ExpiresAt`, `RevokedAt`, `LastUsedAt` | Lifecycle timestamps                                                             |

### `UserApp`

One row per `(UserId, AppId)` pair. Upserted atomically on login. Powers the `app_access` claims
enrichment pipeline.

### `WaitlistInterest`

One row per `(UserId, InterestKind)` pair. The composite primary key makes registration idempotent
at the storage layer.

| Field          | Purpose                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------ |
| `UserId`       | FK → `AspNetUsers.Id`, cascade delete                                                            |
| `InterestKind` | Fixed vocabulary — `services-consumer`, `services-provider`, `connect` (`WaitlistInterestKinds`) |
| `RegisteredAt` | Cohort date for the waitlist-to-active conversion metric (PRD §16)                               |

The row holds no signal beyond the pillar and the date. No protected-class or eligibility field
exists on it (PRD §6). Interests are independent, so nothing collapses them to a persona (PRD
§11.2).

Account soft-delete keeps these rows, because it stamps `DeletedAt` and never hard-deletes the user,
so the cascade FK does not fire. The endpoints hide the rows from a soft-deleted account. Any later
query that reads the table directly — an invite or announcement export, for example — must join
`AspNetUsers` and filter on `DeletedAt IS NULL`, or it contacts accounts that asked to be deleted.

---

## Configuration

```json
// appsettings.json
{
  "Apps": {
    "AllowedApps": ["cribstop", "admin-portal"]
  },
  "AccountRecovery": {
    "RequireConfirmedEmail": false,
    "WebBaseUrl": "https://cribstop.com",
    "ConfirmationPath": "/confirm-email",
    "ConfirmationTokenLifetime": "1.00:00:00",
    "TokenLifetime": "01:00:00",
    "ResendMinimumInterval": "00:01:00",
    "ResendsPerEmailPerHour": 3,
    "ResendsPerEmailPerDay": 10,
    "RequestsPerEmail": 5,
    "ResendsPerAddress": 10,
    "RequestsPerAddress": 15,
    "RedemptionsPerAddress": 30,
    "RegistrationsPerAddress": 30,
    "RequestWindow": "00:15:00",
    "MaxTrackedKeys": 50000,
    "MinimumResponseDuration": "00:00:00.250"
  },
  "ConnectionStrings": {
    "DefaultConnection": "Host=...;Database=account_db;..."
  }
}
```

`AllowedApps` controls which `AppId` values are accepted in `X-App-Id` headers and API key creation.
Unknown values are rejected with `400` (API keys) or silently ignored (login headers).

`AccountRecovery` is the whole policy over the unauthenticated recovery surface — registration,
email confirmation and password reset — configuration rather than constants so an environment can
tighten it without a code change. One section rather than three because it is one policy: a single
window and a single response floor over endpoints that all answer the same question about the same
address. `TokenLifetime` is bound into the password-reset token provider and
`ConfirmationTokenLifetime` into the confirmation one, so each is the lifetime actually enforced at
redemption, and neither touches the other's token. `MinimumResponseDuration` is the floor the reset
and confirmation requests are padded to, which is what keeps the work actually done off the clock.
`RequireConfirmedEmail` is documented in Account Recovery above — read it before flipping it.

---

## Database Migrations

Migrations are in `Migrations/`. In production, they run via an init container:

```bash
dotnet run --project apps/services/account-service -- --migrate-only
```

For local development:

```bash
dotnet ef migrations add <Name> --project apps/services/account-service
dotnet ef database update --project apps/services/account-service
```

---

## Running Tests

```bash
cd apps/services/account-service/Tests
dotnet test
```

Tests use an in-memory EF Core provider — no live database required. The `AccountServiceFactory`
seeds roles and replaces Npgsql with InMemory automatically.

Coverage is collected via `coverlet.collector` and output to `coverage/apps/services/`.
