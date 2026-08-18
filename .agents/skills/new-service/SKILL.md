---
name: new-service
description:
  'Use when standing up, scaffolding, or adding ANY new backend service or deployable project in
  this Nx monorepo — including when a ticket asks you to create one. Covers the full deployable
  unit: generator, nx:reset, tags, Dockerfile, K8s manifests, skaffold module, gateway route, and
  AGENTS.md. Usage: /new-service <name> <node|dotnet|python>'
---

# New Service Scaffold

Arguments: `$ARGUMENTS` — the first is the service name, the second the runtime
(`node|dotnet|python`). Follow every step in order; do not skip any. Source of truth for
conventions: `AGENTS.md` (repo root). Planned services, ports, and responsibilities: `PRD.md`
§2.1–2.2.

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

## 2a. Node services need their own `package.json` and a workspace entry

`setup-workspace-targets.js` gives every Node project `prune-lockfile` and `copy-workspace-modules`
targets, and both hard-fail with `<project>/package.json does not exist.` — so a Node service
without its own manifest cannot produce the pruned `package.json` + `pnpm-lock.yaml` that a slim,
reproducible production image installs from. Create one declaring the service's runtime deps and add
the project to `pnpm-workspace.yaml`.

Adding that manifest changes `pnpm-lock.yaml`, so commit it alongside — see root `AGENTS.md` for the
lockfile rule.

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

Once both suites live in one project, keep `nx test` off the e2e specs with a second jest config
(`jest.config.ts` for unit, `jest.e2e.config.ts` driving an explicit `e2e` target). Mind the
`<rootDir>` gotcha in root `AGENTS.md` when writing those patterns, and confirm the split before
trusting it — `nx:run-commands` forwards extra flags to jest, so
`pnpm exec nx test <name> --listTests` and `pnpm exec nx run <name>:e2e --listTests` list each
config's real matches through the same target CI runs.

## 3. Port assignment & PRD alignment

Check PRD.md §2.1 for the service's planned port (account:3000 … notification:3006), and set it as
the app's default rather than leaving the generator's (`@nx/express` defaults to 3333). If you add a
`.env.example`, its `PORT` must match that default — a `.env.example` disagreeing with the code is
how the service ends up on one port while probes, port-forwards, and e2e setup expect another.

If the service isn't in the diagram, take the next free port. Updating `PRD.md` §2.1/§2.2 to match
is the **product owner's** call, not the engineer's (see `.agents/agents/principal-engineer.md` →
"You never edit `PRD.md`"): note the needed change on the ticket and let them make it.

## 4. Dockerfile

Copy the pattern from the closest existing service (`apps/services/account-service/Dockerfile` for
.NET, `apps/services/multi-model-inference/Dockerfile` for Python). For .NET: copy `nuget.config`
and `global.json` before `dotnet restore` (known CI fix — see git history #19).

Traps that cost real debugging time on the first Node service:

- **Pick a Debian (`-slim`) base, not Alpine** — see the in-cluster DNS rule in root `AGENTS.md`.
  This is a base-image decision, so make it here rather than discovering it from a crash-looping
  pod.
- **`node:20-slim` ships no CA bundle at all**, so appending an enterprise root to
  `/etc/ssl/certs/ca-certificates.crt` fails with "Directory nonexistent". Install `ca-certificates`
  first (apt over HTTP, so no TLS needed to bootstrap) then `update-ca-certificates` — copy the
  block from `multi-model-inference/Dockerfile`, which already does exactly this on
  `python:3.11-slim`.
- **Only `main.js` is bundled.** Webpack bundles the entry point; anything read from disk at runtime
  (`migrations/`, a `migrate.js` runner, seed data files) is NOT in the bundle and must be `COPY`d
  into the runtime image explicitly. Miss it and the migrate step reports "No migrations to run!"
  and exits 0 — a silent no-op, not an error.
- **Keep the package manager out of the runtime stage.** `corepack enable pnpm` there tries to fetch
  `pnpm/latest` from npmjs.org and dies behind SSL inspection. Resolve production dependencies in
  the builder stage (which inherits the CA bundle and the pinned pnpm) and `COPY` the result.
- **Don't verify images with `pnpm run container:build`** — it shells out to `docker`, which does
  not exist on a Podman host. Build through the skaffold path instead (step 9).

## 5. Kubernetes manifests (ALL manifests live in infra/k8s/, never in apps/)

Minimal-base rules (see root `AGENTS.md` § Kustomize Structure):

- `infra/k8s/base/` — Deployment (image, probes, env, security context) + Service. NO
  resources/limits, NO replicas in base. File naming: `<name>.<kind>.yaml`.
- `infra/k8s/hetzner/{dev,test,prod}/patches/` — resources, replicas per env.
- `infra/k8s/podman/local/` — local overlay entry.
- Add to each environment's `kustomization.yaml` in correct order (Secrets → ConfigMaps → Services →
  workloads).
- Validate: `pnpm run infra:validate`

**Copy `account-service.deployment.yaml` field for field — it is the reference, not an example.**
The existing shape is the default path; deviate only where you can name a concrete reason, and say
so. Same key order (image → imagePullPolicy → command → env → resources for the initContainer; image
→ imagePullPolicy → resources → ports → env → liveness/readiness/startup probes for the app
container), same comment placement, discrete `<SERVICE>_DB_HOST/PORT/NAME/USER` env values, and
identical env blocks between the two containers rather than one carrying extra commentary. Per-env
patches override only image / imagePullPolicy / replicas / resources / environment — check the real
conventions before inventing values: test uses the `:test` tag with 2 replicas, prod uses `:latest`
with 3 (not a `:prod` tag).

**Keep insertion position consistent everywhere.** A new service goes in the same relative slot in
every registry — for `property-service` that meant after `account-service` and before `cribstop-web`
in all five `kustomization.yaml` files, all three `deploy-control.yaml` environments, and the
skaffold services module. Verify the _rendered_ result, not just the source:
`kustomize build infra/k8s/<overlay> --enable-alpha-plugins`. Strategic-merge patches reorder list
entries by the patch's order, so ordering you wrote in base can silently change per overlay.

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
- **Retry transient DB failures inside the migration entry point, not from the manifest.** Nothing
  orders your Deployment after the postgres StatefulSet, so on a cold cluster the first attempt
  reliably loses the race, exits non-zero, and fails the whole deploy (`1/8 deployment(s) failed`) —
  even though Kubernetes would eventually restart it. `account-service` already solves this in
  application code: `Program.cs` → `MigrateWithRetryAsync` (12 attempts, 2s backoff doubling to a
  10s ceiling) with `IsTransientDatabaseStartupFailure` whitelisting socket errors plus SQLSTATE
  `3D000` (database not yet created), `42501` (grants race), `28P01` (password still syncing) and
  `57P03` (server starting up). Mirror that; `property-service/migrate.js` is the Node counterpart.
  - Retry ONLY those classes. Retrying everything masks bad SQL and wrong credentials behind 12
    attempts and a rollout timeout instead of failing fast.
  - Resist solving this with a `wait-for-postgres` initContainer. It puts the policy in a different
    layer than the existing service uses, and because a strategic-merge patch reorders
    `initContainers` by the patch's own order, every overlay then has to re-declare the container
    just to stop the wait step being silently reordered _after_ migrate.

## 6. Deployment control — TWO separate registries, both mandatory

This repo gates deployment in two places. Manifests alone deploy nothing; a service missing from
either registry is skipped **silently**, with no error to trace back to.

**6a. Local — `skaffold.yaml`.** Add the artifact + port-forward to the **services** module (never
the clients module). Match the shape of the sibling artifacts: `context: .`, the
`node tools/infra/skaffold-build.js` buildCommand, `dependencies.paths` for the project, and an
`ignore` list for build output and tests. The services-only overlay derives its exclusions from the
_clients_ module, so a new service needs no overlay work.

**6b. CI/CD — `infra/deploy-control.yaml`.** Add the service under
`environments.{dev,test,prod}.services`. This is the one that is easy to miss and impossible to
notice: `.github/actions/load-deploy-control` enumerates services with
`yq '.environments.<env>.services | keys[]'`, so a service absent from that map is never even
considered a deploy candidate — no warning, no failure, it just never ships. Follow the existing
promotion convention: `enabled: true` + `auto_deploy: true` for dev, `enabled: false` for test/prod
until the service is deliberately promoted (that is how `account-service` and `cribstop-web` are
set).

**What you do NOT need to touch:** the CI image-build matrix. `build-push-images.yml` derives it
from Nx projects that have a `container-build` target, which `nx:reset` adds automatically. Don't
add a hardcoded list.

Image name defaults to the Nx project name; only add an entry to `tools/docker/image-name-map.json`
if they must differ (as for `multi-model-inference` → `inference-service`).

## 7. Gateway route

Add the Ocelot route in `apps/api-gateway/Configuration/` (upstream path → new service ClusterIP +
port). Auth is forwarded (cookie / opaque bearer / API key) — do not add JWT anything.

## 8. Project AGENTS.md + root index

Create `apps/services/<name>/AGENTS.md` (copy the shape of an existing service guide: description,
Nx project name, commands, notes) plus a sibling `CLAUDE.md` stub containing `@AGENTS.md` (copy an
existing one), and add one line to the root `AGENTS.md` "Project Guides" list.

## 9. Verify everything

```bash
pnpm exec nx lint <name>
pnpm exec nx test <name>
pnpm exec nx build <name>
pnpm run infra:validate:dev
pnpm run nx:workspace-format
```

All must pass. **Then prove it deploys** — this is the acceptance test for steps 4–6, and the only
thing that distinguishes a real service from a directory that compiles. Deploy the way the repo
deploys; never `kubectl apply` a manifest by hand, and never patch a live object to make a test
pass. Every fix goes back through the infra config and out via skaffold, or you are validating
something you are not shipping.

```bash
pnpm run skaffold:delete            # from a clean slate — a warm cluster hides cold-start races
pnpm run skaffold:services:deploy   # THE gate: its exit code must be 0
```

**Skaffold's exit code is the pass/fail signal, not pod status.** `1/8 deployment(s) failed` is a
failure even when Kubernetes later restarts the container into a healthy state — CI's rollout gate
will not wait for that. Capture it explicitly (`echo "EXIT: $?"`); a passing `kubectl get pods` a
few minutes later proves only that Kubernetes recovered, not that the deploy succeeded.

Then confirm, in this order:

- The migration initContainer **completed** and its log shows what you expect.
  `No migrations to run!` with exit 0 usually means the migrations directory never made it into the
  image — verify the schema really exists (`select count(*) from pgmigrations`), don't trust the
  message.
- Restart count is **0** and the container is `ready=true` (the readiness probe hitting `/health` is
  the cluster's own verdict).
- `/health` answers over the ClusterIP. Prefer a one-shot in-cluster call
  (`kubectl run --rm --image=node:20-slim ...`) over a port-forward — it tests the Service, not just
  the pod, and leaves nothing running.

Sequencing notes that cost time otherwise:

- Run these **one command at a time** when something fails; chained commands bury which step broke.
- `skaffold:delete` followed immediately by a deploy fails on the `ingress-nginx` namespace still
  terminating. Wait for `kubectl get ns` to stop listing it before redeploying — that failure is not
  your service.
- If there's no cluster yet, create one (`pnpm run infra:local:cluster:setup`; registry via
  `infra:local:registry:ensure`, disk recovery via `infra:local:cluster:reset:disk`). The whole
  lifecycle is scripted, so standing the environment up is part of the job, never a blocker to
  report.

Finally: **do not commit until the above has actually passed.** Then summarize what was created —
and if you skipped the gateway route (step 7) because it belongs to a later ticket, say so
explicitly, along with what will and won't work until it lands.
