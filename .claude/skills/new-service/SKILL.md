---
name: new-service
description:
  'Scaffold a new backend service in this Nx monorepo the repo way — generator, nx:reset,
  Dockerfile, K8s manifests, skaffold module, gateway route, and CLAUDE.md. Usage: /new-service
  <name> <node|dotnet|python>'
disable-model-invocation: true
---

# New Service Scaffold

Arguments: `$ARGUMENTS` — the first is the service name, the second the runtime
(`node|dotnet|python`). Follow every step in order; do not skip any. Source of truth for
conventions: `.github/copilot-instructions.md`. Planned services, ports, and responsibilities:
`PRD.md` §2.1–2.2.

## 1. Generate the project (never scaffold manually)

- **node**: `pnpm exec nx generate @nx/express:app <name> --directory=apps/services`
- **python**: `pnpm exec nx generate @nxlv/python:uv-project <name> --directory=apps/services`
- **dotnet**: `dotnet new webapi -n <name> -o apps/services/<name>` (dotnet new is the sanctioned
  path)

## 2. Sync the workspace (MANDATORY after any project creation)

```bash
pnpm run nx:reset
```

This syncs the .NET solution, generates missing targets, and auto-tags the project. Verify:
`pnpm exec nx show projects` lists the new service, and `project.json` has `runtime:*` /
`type:service` tags.

## 3. Port assignment & PRD alignment

Check PRD.md §2.1 for the service's planned port (account:3000 … notification:3006). Use the next
free port if the service isn't in the diagram — and update PRD.md §2.1/§2.2 so the spec stays
current (it is a living doc).

## 4. Dockerfile

Copy the pattern from the closest existing service (`apps/services/account-service/Dockerfile` for
.NET, `apps/services/multi-model-inference/Dockerfile` for Python). For .NET: copy `nuget.config`
and `global.json` before `dotnet restore` (known CI fix — see git history #19).

## 5. Kubernetes manifests (ALL manifests live in infra/k8s/, never in apps/)

Minimal-base rules (see copilot-instructions § Kustomize Structure):

- `infra/k8s/base/` — Deployment (image, probes, env, security context) + Service. NO
  resources/limits, NO replicas in base. File naming: `<name>.<kind>.yaml`.
- `infra/k8s/hetzner/{dev,test,prod}/patches/` — resources, replicas per env.
- `infra/k8s/podman/local/` — local overlay entry.
- Add to each environment's `kustomization.yaml` in correct order (Secrets → ConfigMaps → Services →
  workloads).
- Validate: `pnpm run infra:validate`

## 6. Skaffold

Add the artifact + port-forward to the **services** module in `skaffold.yaml` (never the clients
module). The services-only overlay auto-derives exclusions — zero manual maintenance needed there.

## 7. Gateway route

Add the Ocelot route in `apps/api-gateway/Configuration/` (upstream path → new service ClusterIP +
port). Auth is forwarded (cookie / opaque bearer / API key) — do not add JWT anything.

## 8. Project CLAUDE.md + root index

Create `apps/services/<name>/CLAUDE.md` (copy the shape of an existing service guide: description,
Nx project name, commands, notes) and add one line to the root `CLAUDE.md` "Project Guides" list.

## 9. Verify everything

```bash
pnpm exec nx lint <name>
pnpm exec nx test <name>
pnpm exec nx build <name>
pnpm run infra:validate:dev
pnpm run nx:workspace-format
```

All must pass. Then summarize what was created and remind the user that `pnpm run skaffold:services`
will deploy it locally.
