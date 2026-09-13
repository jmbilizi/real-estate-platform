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
- **Password recovery is this service's own, not `MapIdentityApi`'s.**
  `POST /account/password/forgot` and `POST /account/password/reset` (`Routes/PasswordReset.cs`);
  Identity's `/account/forgotPassword` and `/account/resetPassword` are suppressed to `404`
  (`Routes/IdentityApiSuppression.cs`) because they only issue a token when `IsEmailConfirmedAsync`
  is true and nothing here confirms an address — they answered 200 having done nothing. The request
  endpoint's response is identical for registered and unregistered addresses **including its
  timing**; anything added to that handler has to preserve that, and the parity tests in
  `Tests/Integration/PasswordResetEndpointTests.cs` are there to catch it if not.
- **Reset mail is not sent here.** The endpoints issue a token and hand it to
  `IPasswordResetNotifier`; the stand-in logs a warning (event id 1360) per issued token and never
  logs the token. Delivery is one DI registration — the API does not change to add it.
- CPM: versionless `<PackageReference>`; run `pnpm run nx:reset` after project structure changes.
