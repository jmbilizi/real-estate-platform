# Active Ocelot Routes

This folder holds the route configuration files that the gateway loads at startup.

## How It Works

1. Gateway starts → `Startup.ConfigureServices()` runs
2. `JsonMerger` reads all `*.json` files from this folder
3. Merges them in-memory with `Configuration/Ocelot.Settings.json`
4. Ocelot uses the merged configuration for routing

## Routing Convention

**Upstream path templates** are namespaced by **service domain**, not client name:

- `/account/*` (Account service)
- `/property/*` (Property service)
- `/inference/*` (Inference service)

No `/gateway` prefix — the gateway base URL supplies it.

**Downstream paths** match the service's actual endpoints and do not require upstream matching. Example: `/property/listings` maps to `/listings` at the property service.

When upstream and downstream differ, set `SwaggerEndPoints[].TransformByOcelotConfig` to `true` so the aggregated Swagger UI publishes correct paths.

**SwaggerEndPoints** carry one entry per **service domain**, keyed on the domain (`Account`, `Property`, `Inference`), never on individual resources — the key forms a segment of the aggregated docs URL (`/swagger/docs/v1/<Domain>`).

## Adding Routes

Copy the pattern from an existing live route file:

- `account-service-routes.json` — upstream and downstream paths match (same domain)
- `property-service-routes.json` — upstream and downstream paths differ (gateway namespace differs from service path)

```bash
# Copy from existing route file as a template
cp account-service-routes.json your-service-routes.json

# Edit the copy: update ServiceName, Key, and path templates
# Then restart gateway or trigger file watcher reload
```

## Route File Naming

Name each file `<service-name>-routes.json`, matching the service's deployment identity and corresponding entry in `infra/deploy-control.yaml`.

## Important Notes

- ✅ Files in this folder are read at gateway startup
- ✅ Use the live route files as examples, not separate templates
- ✅ Route files are deployment artifacts, versioned with each service
- ❌ Do not edit route files directly in this folder; update them in the service repo
