# Active Ocelot Routes Folder

This folder contains route configuration files that are **READ** at gateway startup.

## How It Works

1. Gateway starts → `Startup.ConfigureServices()` runs
2. `JsonMerger` READS all `*.json` files from this folder
3. Merges them IN-MEMORY with `Configuration/Ocelot.Settings.json`
4. Ocelot uses the merged configuration for routing

## Important Notes

- ❌ JsonMerger does NOT create files here
- ❌ Nothing is written to disk automatically
- ✅ YOU must manually place route files here
- ✅ Files are read-only at startup

## To Add Routes

```bash
# Copy from templates
cp ../Templates/Routes/account-service-routes.json ./

# Or copy from service repo when deploying
cp apps/services/account-service/ocelot-route.json \
   apps/api-gateway/Configuration/Routes/account-service-routes.json

# Then restart gateway
dotnet run
```

## Current State

This folder is intentionally EMPTY. Routes are in `Templates/` folder as references.
When services are built, copy their route definitions here.
