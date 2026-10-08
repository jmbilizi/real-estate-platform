# Account Service

Manages user identity, authentication, and authorization for the real-estate platform. Built on
ASP.NET Core 10 Minimal APIs with ASP.NET Identity.

## Responsibilities

- Sign-up, sign-in, password reset and email change by email code, and session management
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
| `Agent`      | Handles assigned buyer leads (Lead Desk). A facet: it combines with every other role   |
| `User`       | Standard platform user (assigned automatically on registration)                        |

Role assignment rules enforced server-side:

- Only `SuperAdmin` can assign or remove `SuperAdmin` and `Admin` roles.
- `Admin` can only assign/remove `Moderator`, `Developer`, `Support`, `Agent`, and `User`.
- Every grant and removal writes one `RoleGrantAudits` row: grantor, grantee, role, action, UTC
  time. The table is append-only and has no foreign key to `AspNetUsers`.

**Grant the first `SuperAdmin` per environment (#628).** No endpoint can do it, because every grant
needs an existing `Admin` or `SuperAdmin`. A human with database access runs one statement against
`account_db`, with the account email as a parameter. Never commit an email.

```sql
INSERT INTO "AspNetUserRoles" ("UserId", "RoleId")
SELECT u."Id", r."Id" FROM "AspNetUsers" u, "AspNetRoles" r
WHERE u."NormalizedEmail" = upper(:email) AND r."Name" = 'SuperAdmin'
ON CONFLICT DO NOTHING;
```

The account must exist already. Run it again to confirm: it grants nothing twice. Then use
`POST /account/{userId}/roles` for every later grant, so each one is audited.

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

## Sign-in, Sign-up and Account Recovery by Code

Every flow that proves control of a mailbox runs on a 6-digit email code. Only a verified code
creates an account. `POST /account/signup/complete` is the only endpoint that creates an
`ApplicationUser`, and it creates it confirmed. No setting turns confirmation on or off. Identity's
`/register`, `/confirmEmail`, `/resendConfirmationEmail`, `/forgotPassword` and `/resetPassword` do
not exist: they answer `404` and are absent from OpenAPI. `AccountCreationSurfaceTests` lists every
endpoint, fails on an unlisted one, and probes each with a registration body.

| Flow         | Endpoints                                                 | Auth         |
| ------------ | --------------------------------------------------------- | ------------ |
| Sign-in step | `POST /account/identify`                                  | Anonymous    |
| Sign-up      | `POST /account/signup/{start,verify,resend,change-email}` | Anonymous    |
| Sign-up      | `POST /account/signup/complete`                           | Signup proof |
| Reset        | `POST /account/password/reset/{start,verify,complete}`    | Anonymous    |
| Email change | `POST /account/email/change/{start,verify}`               | Session      |
| Secure       | `POST /account/secure`                                    | Notice token |

**Sign-in step.** `identify` takes an email and answers the next step: `password` for a confirmed,
active account, `code` for every other valid address. Both answers have one JSON shape and run under
the timing floor.

**Sign-up.** `start` sends a code. `verify` checks it and returns a `signupProof`. `complete` takes
`{ email, signupProof, password }`, creates the account and signs it in. No `ApplicationUser` exists
before `complete`. A pending sign-up is a `PendingRegistrations` row that expires 30 minutes after
the last code.

**Reset.** `start` sends a code to a confirmed, live account. `verify` returns a `resetProof`.
`complete` takes `{ email, resetProof, newPassword }`, sets the password, ends every session and
answers `204`. It signs nobody in.

**Email change.** The caller proves the current password or a code sent to the old address. A code
goes to the new address. `verify` swaps the address and signs the caller in again.

**Secure account.** Each security notice carries a "This wasn't me" link. `POST /account/secure`
takes the token, restores the old email after an email change, removes the password and ends every
session. The owner then sets a password by the reset flow.

### Code design

| Property                            | Value                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| Code                                | 6 digits, 10 minute life, single use                                           |
| Storage                             | Keyed HMAC of the code (`ACCOUNT_SERVICE_EMAIL_CODE_HMAC_KEY`), never the code |
| Wrong tries                         | 5 wrong tries lock that email and purpose for 15 minutes                       |
| New code                            | Does not reset the wrong-try count (`EmailCodeThrottles` row is separate)      |
| Resend                              | 60 second cooldown, 5 per hour, 10 per day per email and purpose               |
| Proof (`signupProof`, `resetProof`) | 32 random bytes, stored as a SHA-256 hash, 15 minute life, single use          |
| No engine key                       | Every call answers `503`                                                       |

Purposes: `SignUp`, `PasswordReset`, `EmailChangeNew`, `EmailChangeOld`. A refused password gives
the proof back.

### Same answer for every address

A caller learns nothing about whether an address has an account:

| Request                                     | Response                                    |
| ------------------------------------------- | ------------------------------------------- |
| `/login`, wrong password, unknown or locked | `401` `detail: "Failed"`                    |
| `/signup/start`, address with an account    | Like a new address. The owner gets a notice |
| `/password/reset/start`, any address        | `200`                                       |
| `/password/reset/verify`, any address       | The same wrong-code answer and tries left   |

The code engine counts no wrong try without an open code. `AccountRecoveryRateLimiter` counts the
decoy tries in memory, so the tries left and the lock match. Every code endpoint and `/login` answer
no faster than `AccountRecovery:MinimumResponseDuration` (250ms).

### Limits

`429` with `Retry-After`, counted before any account lookup in
`Helpers/AccountRecoveryThrottleFilter.cs`. Client identity is `X-Real-IP`, which the gateway sets.
Counters are per process. The gateway adds its own per-route limits
(`apps/api-gateway/Configuration/Routes/account-service-routes.json`).

| Limit                                        | Setting                                    | Default |
| -------------------------------------------- | ------------------------------------------ | ------- |
| Code sends per client address per window     | `AccountRecovery:SignUpSendsPerAddress`    | 20      |
| Code checks per client address per window    | `AccountRecovery:SignUpVerifiesPerAddress` | 20      |
| Identify calls per client address per window | `AccountRecovery:IdentifiesPerAddress`     | 20      |
| Identify calls per email per window          | `AccountRecovery:IdentifiesPerEmail`       | 5       |
| Sign-up address changes per email per window | `AccountRecovery:RequestsPerEmail`         | 5       |
| Window for the counters                      | `AccountRecovery:RequestWindow`            | 15m     |

Each flow counts in its own scope, so a reset never spends a sign-up counter.

### Session revocation

A reset, a password change, an email change and a secure-account call each rotate the security
stamp. The stamp ends every cookie session on its next request and every refresh token. It ends
every bearer access token too, because `BearerStampCheck` validates the stamp on each request. A
password change or an email change then signs the caller in again as the same kind of session. A
successful reset also clears any lockout.

### Security events

`AccountSecurityEvents` is append-only, with no FK to the account. Kinds: `PasswordReset`,
`PasswordChanged`, `EmailChanged`, `SecureAccount`. `ClientAddressHash` is an HMAC of the client
address under the code key, never the address. After a reset, a password change or an email change,
`SecurityNoticeService` mails the address the account had before the change. It skips a suppressed
address and never blocks the action. The notice carries a single-use token (hash stored, 7 day life)
for the secure-account link: `AccountRecovery:WebBaseUrl` + `AccountRecovery:SecureAccountPath`.

### Delivery

`PostmarkDeliveryQueue` is the `IOutboundEmailSender` every composed message goes through. It is
also the background service that drains the queue, so a send never blocks the request. The queue
retries a transport failure a bounded number of times, then logs loudly. If `Postmark:ServerToken`
is still the committed placeholder, nothing is sent and the queue logs event `1370`. Accepted,
rejected and exhausted-retry outcomes log events `1371`/`1372`/`1373`, keyed by message kind. The
code, the link and the message body are never logged. `PostmarkEmailSender` is the
`IEmailSender<ApplicationUser>` that `MapIdentityApi` requires. Every member throws, because nothing
sends an Identity link or code.

**Sender identity** (configuration, section `Email`): from
`Cribstop (Real Broker, LLC) <no-reply@cribstop.com>`, reply-to `contact@cribstop.com`. Every body
ends with `Email:BrokerageDisclosure` (PRD §6).

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

Soft-delete also blocks **new** sessions (#152). `AppSignInManager.CanSignInAsync` refuses a
soft-deleted account on every sign-in path, and `ValidateSecurityStampAsync` refuses it for cookie
revalidation and `/account/refresh`. `/account/login` answers a deleted account with the same
`Failed` problem as a wrong password or an unknown address.

Bearer **access** tokens are revoked the same way (#142). `BearerTokenHandler` has no
principal-validation event, so `BearerStampCheck` runs from `BearerTokenEvents.OnMessageReceived`.
It unprotects the token and calls `SignInManager.ValidateSecurityStampAsync`. A token issued before
any stamp rotation (soft-delete, admin suspension, password reset) gets `401` on its next use. Cost:
one user read per bearer request, the same as the cookie path. `/internal/account/introspect` makes
the same stamp check, so both agree.

---

## API Endpoints

### Identity (built-in ASP.NET Identity)

| Method | Path                             | Description                      |
| ------ | -------------------------------- | -------------------------------- |
| `POST` | `/account/login`                 | Login — returns bearer token     |
| `POST` | `/account/login?useCookies=true` | Login — sets auth cookie         |
| `POST` | `/account/refresh`               | Refresh a bearer token           |
| `POST` | `/account/logout`                | Logout (revokes cookie/token)    |
| `POST` | `/account/manage/2fa`            | Manage two-factor authentication |
| `GET`  | `/account/manage/info`           | Read the caller's email          |
| `POST` | `/account/manage/info`           | Change the password              |

`login`, `refresh` and `manage/*` are Identity's own handlers. `Routes/IdentityEndpoints.cs` maps
Identity into a detached route builder and hides `register`, `confirmEmail`,
`resendConfirmationEmail`, `forgotPassword` and `resetPassword` before the app sees them. The
code-based endpoints are in "Sign-in, Sign-up and Account Recovery by Code".

`POST /manage/info` with a new email answers `400`: an email change runs on `/account/email/change`.
`POST /manage/info` with a new password needs `oldPassword`, applies the password policy and the
breached-password check, ends every other session, writes a `PasswordChanged` security event and
mails a notice. A wrong `oldPassword` counts toward the sign-in lock.

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

| Method | Path                           | Auth shape (forwarded as-is)                          | Description                                                                                                                  |
| ------ | ------------------------------ | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/internal/account/introspect` | `Cookie`, `Authorization: Bearer ...`, or `X-Api-Key` | Resolves forwarded credentials to `accountId`, validity flags and, when valid, `roles` (array), `email` and `emailConfirmed` |

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
    "WebBaseUrl": "https://cribstop.com",
    "RequestsPerEmail": 5,
    "IdentifiesPerAddress": 20,
    "IdentifiesPerEmail": 5,
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

`AccountRecovery` is the whole policy over the unauthenticated code surface — sign-up, identify,
reset, email change and secure account — configuration rather than constants so an environment can
tighten it without a code change. It is one policy: a single window and a single response floor over
endpoints that all answer the same question about the same address. `WebBaseUrl` builds the
secure-account link. `MinimumResponseDuration` is the floor the code endpoints and `/login` are
padded to, which keeps the work actually done off the clock. The code engine has its own section,
`EmailCodes`.

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
