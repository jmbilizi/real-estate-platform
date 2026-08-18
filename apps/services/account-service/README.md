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

Because `ValidationInterval = TimeSpan.Zero`, the next request from that user's cookie or bearer
token triggers a stamp mismatch → the session is rejected with `401` immediately. There is no expiry
window.

---

## API Endpoints

### Identity (built-in ASP.NET Identity)

| Method | Path                             | Description                      |
| ------ | -------------------------------- | -------------------------------- |
| `POST` | `/account/register`              | Register a new account           |
| `POST` | `/account/login`                 | Login — returns bearer token     |
| `POST` | `/account/login?useCookies=true` | Login — sets auth cookie         |
| `POST` | `/account/refresh`               | Refresh a bearer token           |
| `POST` | `/account/logout`                | Logout (revokes cookie/token)    |
| `GET`  | `/account/confirmEmail`          | Confirm email address            |
| `POST` | `/account/forgotPassword`        | Trigger password reset email     |
| `POST` | `/account/resetPassword`         | Complete password reset          |
| `POST` | `/account/manage/2fa`            | Manage two-factor authentication |

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

- Cache semantics are explicit: `Cache-Control: no-store, no-cache, max-age=0`. Any caller-side
  caching defeats the immediate revocation this endpoint exists to provide.
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

---

## Configuration

```json
// appsettings.json
{
  "Apps": {
    "AllowedApps": ["cribstop", "admin-portal"]
  },
  "ConnectionStrings": {
    "DefaultConnection": "Host=...;Database=account_db;..."
  }
}
```

`AllowedApps` controls which `AppId` values are accepted in `X-App-Id` headers and API key creation.
Unknown values are rejected with `400` (API keys) or silently ignored (login headers).

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
