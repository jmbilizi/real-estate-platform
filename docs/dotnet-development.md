# .NET Development

## Setup

```bash
pnpm run dotnet:env
```

Installs .NET SDK (if missing), global tools, and Nx plugin.

## Creating Projects

Use standard `dotnet new` commands:

```bash
# Web API
dotnet new webapi -n MyApi -o apps/my-api

# Console App
dotnet new console -n MyApp -o apps/my-app

# Class Library
dotnet new classlib -n MyLib -o libs/my-lib

# Tests
dotnet new xunit -n MyApi.Tests -o apps/my-api/tests
```

After creating or deleting projects:

```bash
pnpm run dotnet:setup-projects
```

This script:

- Syncs `real-estate-platform.sln` with all .csproj files
- Creates/updates `project.json` files with Nx targets
- Intelligently adds missing targets based on project type:
  - **Applications** (non-test): build, serve, lint, format, format-check
  - **Test projects**: build, test, lint, format, format-check
  - **Libraries**: build, lint, format, format-check

> **Note**: This also runs automatically as part of `pnpm run nx:reset` and during pre-commit hooks,
> ensuring solution files stay synchronized.

## Configuration

All .NET configuration files are at **workspace root** (auto-discovered by MSBuild/.NET):

- `Directory.Build.props` - MSBuild properties for all projects
- `Directory.Build.targets` - Post-build targets
- `Directory.Packages.props` - Central package management (CPM)
- `global.json` - .NET SDK version pinning
- `.editorconfig` - Code style rules (multi-language, includes C# StyleCop rules)
- `nuget.config` - NuGet package sources and restore settings

### EditorConfig Hierarchy

**Root config** (`.editorconfig` at workspace root with `root = true`):

- Defines default rules for all .NET projects
- Automatically discovered via upward search from each project
- Projects inherit all rules unless they have their own `.editorconfig`

**Project-specific overrides** (optional `.editorconfig` in project folder with `root = false`):

- Used only when you need different rules for a specific project
- Inherits from root config, then applies local overrides
- Most projects don't need this - root config is sufficient

**Example**: To disable a specific rule for one project, create `apps/my-api/.editorconfig`:

```ini
root = false  # Inherit from workspace root
[*.cs]
dotnet_diagnostic.SA1101.severity = none  # Override: disable "prefix with this"
```

## Common Commands

```bash
# Build/run
nx build my-api
nx serve my-api
nx test my-api-tests

# All .NET projects
pnpm run nx:dotnet-build
pnpm run nx:dotnet-test
```

**Problem**: After creating a .NET project, Nx doesn't recognize it.

**Solution**:

```bash
# Run the reset command to detect projects
pnpm run nx:reset

# Verify project was detected
nx show projects
```

#### Build Fails with Dependency Errors

**Problem**: Project builds fail due to missing dependencies.

**Solution**:

```bash
# Ensure project references are correct
cd apps/my-api
dotnet add reference ../../libs/my-library/MyLibrary.csproj

# Rebuild with Nx
nx build my-api
```

#### .NET SDK Issues

**Problem**: Wrong .NET SDK version or SDK not found.

**Solution**:

```bash
# Verify and fix environment
pnpm run dotnet:env

# Check installed SDKs
dotnet --list-sdks

# Check required version
type tools\dotnet\configs\global.json
```

#### Targets Not Available

**Problem**: Expected targets like `serve` or `test` don't exist.

**Solution**:

- `serve` target: Only created for executable projects (web apps, console apps)
- `test` target: Only created for test projects (xunit, nunit, mstest)
- `pack` target: Only created for class libraries

Verify project type in `.csproj`:

```xml
<PropertyGroup>
  <OutputType>Exe</OutputType>  <!-- For executable -->
  <IsTestProject>true</IsTestProject>  <!-- For tests -->
</PropertyGroup>
```

#### Tools Not Installed

**Problem**: Global .NET tools are missing.

**Solution**:

```bash
# Reinstall all tools
pnpm run dotnet:env

# Verify tools are installed
dotnet tool list --global
```

### Getting Help

If you encounter issues:

1. Run `pnpm run dotnet:env` to verify and fix your environment
2. Check that you have the correct .NET SDK version (see `tools/dotnet/configs/global.json`)
3. Verify that required tools are installed: `dotnet tool list --global`
4. Check the Nx plugin documentation: https://nx.dev/nx-api/dotnet
5. Review the official .NET CLI docs: https://docs.microsoft.com/dotnet/core/tools/

---

## Database Migrations (EF Core)

### Approach: K8s Init Container

Migrations run in a **Kubernetes init container** using the same image as the service. The app
binary accepts a `--migrate-only` flag that runs `MigrateAsync()` and exits. K8s guarantees the main
container does not start until the init container exits with code 0.

```
Pod startup sequence:
  [init: migrate] → MigrateAsync() → exit 0
                                          ↓
                              [api] starts (DB schema guaranteed up to date)
```

This means the running application **never calls MigrateAsync()**. The app trusts that the schema is
correct by the time it starts.

### Why not migrate on app startup?

| Risk                                   | Impact                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------- |
| Multiple replicas start simultaneously | All pods race to apply the same migration                              |
| Migration fails mid-way                | Pod crashes → K8s restarts it → retries the broken migration in a loop |
| Rolling deploy (old + new pods live)   | Old pod may run against a schema it wasn't built for                   |
| Slow migration blocks readiness probes | Pod killed before migration completes                                  |

The init container pattern eliminates the first three. Rolling deploys still require care — see
[two-phase deploys](#rolling-back-a-migration) below. K8s runs exactly one init container per pod
before the app starts, and `MigrateAsync` uses a PostgreSQL advisory lock so concurrent init
containers (e.g. when `replicas > 1`) serialise safely — one applies, the others wait and exit 0.

### How migrations are structured

Each service owns its own EF Core migrations in a `Migrations/` folder alongside the service code:

```
apps/services/account-service/
├── Data/
│   └── AccountDbContext.cs       # IdentityDbContext<IdentityUser>
├── Migrations/
│   ├── 20260527035441_InitialCreate.cs
│   ├── 20260527035441_InitialCreate.Designer.cs
│   └── AccountDbContextModelSnapshot.cs
└── Program.cs                    # --migrate-only flag handled here
```

### Adding a new migration

```bash
# From the workspace root
dotnet ef migrations add <MigrationName> \
  --project apps/services/account-service \
  --startup-project apps/services/account-service
```

Commit the generated migration files. The next deployment will apply them automatically via the init
container.

### Rolling back a migration

EF Core does not auto-rollback in K8s. If a bad migration is deployed:

1. **Immediately**: The init container will keep failing → main container never starts → old pods
   stay live (rolling deploy). No downtime if `replicas > 1`.
2. **Fix**: Either revert the migration code and redeploy, or add a new corrective migration.
3. **Last resort** (manual): Run a temporary pod with the previous image and override the command to
   invoke the migration downscript directly via `psql`, or use a one-off K8s Job that runs
   `dotnet account-service.dll --migrate-only` from the previous image tag. The runtime image does
   not include EF tooling (`dotnet ef`) — that lives in the SDK image only.

> This is why destructive migrations (dropping columns, renaming) should use a **two-phase deploy**:
> Phase 1 — deploy code that works with both old and new schema. Phase 2 — deploy the migration that
> removes the old column.

### `--migrate-only` implementation

`Program.cs` checks for the flag before building the web host:

```csharp
if (args.Contains("--migrate-only"))
{
    await RunMigrationsAsync().ConfigureAwait(false);
    return; // exits cleanly, init container completes
}
// normal app startup follows...
```

`RunMigrationsAsync` builds its own minimal `DbContext` directly from env vars (no DI, no web host)
and calls `MigrateWithRetryAsync` which retries up to 12 times with exponential backoff (2s → 10s
cap) to handle the case where PostgreSQL itself isn't ready yet at pod startup.

### Retry logic

The init container handles transient DB connection failures itself, so K8s `restartPolicy` is a last
resort rather than the primary retry mechanism:

```
Attempt 1  → connect fails (Postgres still starting) → wait 2s
Attempt 2  → connect fails → wait 4s
Attempt 3  → connect fails → wait 8s
Attempt 4+ → wait 10s (capped)
...up to 12 attempts (~90s total before hard failure)
```

Only `NpgsqlException` with a `SocketException` / `TimeoutException` inner, or a "Failed to connect"
message, is treated as transient. All other exceptions (bad SQL, wrong schema) fail immediately.

### Deployment YAML structure

The init container is defined in `infra/k8s/base/deployments/account-service.deployment.yaml` and
each environment overlay patches the image tag:

| Environment  | Init container image                  | Managed by                        |
| ------------ | ------------------------------------- | --------------------------------- |
| podman/local | `account-service` (Skaffold resolves) | `infra/k8s/podman/local/patches/` |
| hetzner/dev  | `…/account-service:dev`               | `infra/k8s/hetzner/dev/patches/`  |
| hetzner/test | `…/account-service:test`              | `infra/k8s/hetzner/test/patches/` |
| hetzner/prod | `…/account-service:latest`            | `infra/k8s/hetzner/prod/patches/` |

The init container always uses the **same image tag as the main container** in every environment,
ensuring the migration code and the application code are always in sync.
