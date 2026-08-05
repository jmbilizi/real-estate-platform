---
name: new-service
description:
  'Use when standing up, scaffolding, or adding ANY new backend service or deployable project in
  this Nx monorepo — including when a ticket asks you to create one. Covers the full deployable
  unit: generator, nx:reset, tags, Dockerfile, K8s manifests, skaffold module, gateway route, and
  CLAUDE.md. Usage: /new-service <name> <node|dotnet|python>'
---

# New Service Scaffold

Arguments: `$ARGUMENTS` — the first is the service name, the second the runtime
(`node|dotnet|python`). Follow every step in order; do not skip any. Source of truth for
conventions: `.github/copilot-instructions.md`. Planned services, ports, and responsibilities:
`PRD.md` §2.1–2.2.

## 0. A service is not done until it is deployable

Steps 1–3 produce an Nx project. Steps 4–6 are what make it a _service_. Splitting them is the
single most likely way this goes wrong, so:

- **A ticket that says "no infra/Kubernetes changes required" for a new deployable is a defective
  ticket, not a licence to skip steps 4–6.** A pre-provisioned database does not make a service
  deployable — without a Dockerfile, Deployment/Service manifests, a skaffold artifact, and env
  wiring, `pnpm run skaffold:services` will not build or run it, and nothing downstream (gateway
  route, client integration) can ever resolve. Say so on the ticket and do the infra anyway.
- The one boundary that is safe to defer is the **gateway route (step 7)** and anything that _calls_
  the service. A service that is deployed, health-green, and routed to by nobody breaks nothing. A
  service that is routed to but not deployed returns 502.
- The exception is a genuinely non-deployable project (a shared `libs/` package). Then steps 4–7
  don't apply — say which and why, and keep the rest.

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

**Then replace the auto-tag placeholders.** `nx:reset` writes `framework:unassigned`,
`scope:unassigned`, and `devteam:unassigned` — those are prompts for you, not finished values.
Shipping them means `tag:*` commands silently miss the project. Set all three to real values
matching what sibling services use.

## 2b. Fold the generator's `-e2e` sibling into the service project

`@nx/express:app` (and the Node generators generally) create a **second** Nx project, `<name>-e2e`.
This repo does not use that layout — every service is ONE project with its tests inside it:
`apps/services/account-service/Tests/` (`test` = `dotnet test` with `cwd` on `Tests`) and
`apps/services/multi-model-inference/tests/`. Match that:

- Move the e2e specs and support files under `apps/services/<name>/tests/`.
- Delete the `<name>-e2e` project directory and its `project.json`, then `pnpm run nx:reset`.
- Keep unit specs beside their subject (`src/**/*.spec.ts`) and integration/e2e specs under
  `tests/`.

Leaving the sibling in place forces a workaround: `tools/nx/setup-standard-targets.js` gives every
`runtime:node` project a jest `test` target, CI's `nx:node-test` sweeps them all, and the e2e spec
then runs with no server and fails. Deleting the project is the fix; a `nx:noop` `test` target is
not.

## 3. Port assignment & PRD alignment

Check PRD.md §2.1 for the service's planned port (account:3000 … notification:3006), and set it as
the app's default rather than leaving the generator's (`@nx/express` defaults to 3333). If you add a
`.env.example`, its `PORT` must match that default — a `.env.example` disagreeing with the code is
how the service ends up on one port while probes, port-forwards, and e2e setup expect another.

If the service isn't in the diagram, take the next free port. Updating `PRD.md` §2.1/§2.2 to match
is the **product owner's** call, not the engineer's (see `.claude/agents/principal-engineer.md` →
"You never edit `PRD.md`"): note the needed change on the ticket and let them make it.

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

### 5b. If the service owns a database

The Postgres StatefulSet already provisions per-service databases and users
(`infra/k8s/base/configmaps/postgres.configmap.yaml` — `account_db`, `messaging_db`, `property_db`,
each with its own owner and extensions). "The database already exists" is where the work _starts_,
not where it ends. Wire all three of these or the pod cannot talk to it:

- **Connection env on the container**, host `postgres-svc` port `5432`, with the password pulled
  from `secretKeyRef` → `postgres-secret` / `<SERVICE>_SERVICE_DB_USER_PASSWORD`. Never inline a
  credential in a manifest. If the app reads a single `DATABASE_URL`, assemble it from those parts
  the way the app expects.
- **Migrations as an initContainer**, mirroring `account-service.deployment.yaml`: same image as the
  main container, a command that runs migrations and exits (`--migrate-only` there), same DB env. Do
  not rely on migrating at app startup, and do not rely on a local `.env` file — containers have env
  vars, not `.env` files, so a migrate command written as `--envPath .env` will not work in-cluster.
- **A migration path that exists in the built image.** A target that runs `ts-node` against `src/`
  works on a dev box and not in a container; make sure whatever the initContainer invokes is present
  in the build output.

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

All must pass. **Then prove it deploys** — this is the acceptance test for steps 4–6, and the only
thing that distinguishes a real service from a directory that compiles:

```bash
pnpm run skaffold:services:deploy
```

Confirm the pod reaches Ready, the migration initContainer completed, and the health endpoint
answers through its port-forward. A green `nx build` says nothing about any of that.

If there's no cluster yet, create one (`pnpm run infra:local:cluster:setup`; registry via
`infra:local:registry:ensure`, disk recovery via `infra:local:cluster:reset:disk`) — the whole
lifecycle is scripted, so standing the environment up is part of the job, never a blocker to report.

Then summarize what was created — and if you skipped the gateway route (step 7) because it belongs
to a later ticket, say so explicitly, along with what will and won't work until it lands.
