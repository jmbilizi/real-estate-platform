# API Gateway (api-gateway)

Ocelot-based .NET gateway — single entry point routing to internal microservices. Nx project name:
**`api-gateway`**.

## Commands

```bash
pnpm run gateway:serve                 # nx serve api-gateway
pnpm exec nx build api-gateway         # Also: lint, type-check, format
pnpm run nx:dotnet-build               # All .NET projects
```

## Notes

- Auth is **forwarded, not issued here**: cookie / opaque bearer / API key, validated by
  account-service (PRD §11.1). No JWT.
- Swagger aggregation via MMLib.SwaggerForOcelot; routing config lives in `Configuration/`.
- .NET conventions: Central Package Management (`Directory.Packages.props` at repo root) —
  versionless `<PackageReference>`; `.editorconfig` at root drives style; `pnpm run nx:reset` after
  any project add/remove to resync the .sln.
- See `PRD.md` §2 for the gateway's role in the overall architecture.
