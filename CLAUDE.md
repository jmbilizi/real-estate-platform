# Real Estate Platform (Cribstop) — Monorepo Guide

Airbnb-inspired real estate marketplace — **Homes** (buy/sell/rent), **Services** (professional
marketplace), **Connect** (community). Consumer brand Cribstop.com, brokered by Real Broker, LLC
(MD/DC/VA). Nx polyglot monorepo: Node/TypeScript, .NET, Python.

## Project Guides (nested CLAUDE.md, auto-loaded per directory)

- `apps/clients/cribstop/CLAUDE.md` — Next.js consumer web app
- `apps/api-gateway/CLAUDE.md` — Ocelot (.NET) API gateway
- `apps/services/account-service/CLAUDE.md` — .NET identity/auth service
- `apps/services/multi-model-inference/CLAUDE.md` — Python inference service

## Key Docs (read before deep work)

- `.github/copilot-instructions.md` — **repo conventions bible**: all commands, git hooks, CI/CD,
  Kubernetes. When in doubt, check here first.
- `PRD.md` — product spec (living doc): domain model, services, compliance.
- `infra/k8s/readme.md` — infrastructure quick start and ops.

## Repo-Wide Rules

1. **Never run raw tool commands** (`npx eslint`, `dotnet build`, `pytest`, `kubectl apply`). Always
   use `pnpm run ...` / `pnpm exec nx ...` wrappers.
2. **Cross-platform first** — Windows/macOS/Linux. Node scripts in `tools/`, never bash-only or
   `.bat`-only solutions.
3. **After creating/deleting any project**: `pnpm run nx:reset` (syncs .NET solution, generates
   targets, auto-tags).
4. **Never bypass git hooks** (`--no-verify`), never force-push.
5. **Compliance in all user-facing copy/mock data**: Fair Housing, Real Broker LLC brand prominence,
   no fabricated data — see PRD.md §6 and the cribstop project guide.
6. **The whole local infra lifecycle is scripted — manage it yourself, never ask.** Cluster,
   registry, images, and deploys all have `pnpm run` scripts (see Commands below and `package.json`
   → "Local Cluster Lifecycle" / "Local Container Registry"). If the cluster isn't up, create it; if
   it's wedged or out of disk, reset it. Never ask whether the environment is available — that's a
   question you answer with a command. Only genuine external dependencies (secrets, paid accounts,
   sign-offs) need a human.
7. **A new deployable isn't done until it deploys.** Creating an Nx service/app means the full
   `new-service` skill checklist — Dockerfile, `infra/k8s/` manifests, skaffold artifact, env/secret
   wiring — verified with `pnpm run skaffold:services:deploy`, not just a green `nx build`. A ticket
   that scopes infra out is a defective ticket; flag it and build it correctly.

## Commands (repo level)

```bash
pnpm run skaffold:services             # Backend services in local K8s
pnpm exec nx lint <project>            # Single project: lint | test | type-check
pnpm run nx:node-lint                  # Bulk by language: nx:{node|dotnet|python}-{target}
pnpm run nx:workspace-format           # Fix formatting repo-wide
pnpm run pre-commit                    # Fast validation (format+lint+type-check)
pnpm run pre-push                      # Full validation (+ test + build)
pnpm install && pnpm run hooks:setup   # First-time setup
pnpm run infra:local:cluster:setup     # Local cluster: also :delete | :reset:disk | :images:list
pnpm run infra:local:registry:ensure   # Local registry: also :status | :delete
pnpm run skaffold:services:deploy      # One-shot deploy (vs. skaffold:services watch loop)
pnpm run infra:validate:dev            # Kustomize validation per env
```

## Layout

- `apps/` — deployable projects (gateway, services, clients); `libs/` — shared libraries (created on
  demand via Nx generators).
- `infra/k8s/` — ALL K8s manifests (Kustomize base + per-env overlays).
- `tools/` — cross-platform Node automation scripts (source of truth).

## Claude Code Automation Conventions

- Repo-wide skills/agents/hooks live in root `.claude/` with no prefix.
- **Project-specific skills**: nest them in the project (`apps/<...>/.claude/skills/`) — they
  surface with a path prefix and win over root skills of the same name.
- **Project-specific hooks and subagents** (root-only discovery): name them with the project prefix,
  e.g. `cribstop-compliance-reviewer`.

## Repo-Wide Gotchas

- Test a changed project directly by name (`pnpm exec nx test <project>`); `nx affected` needs a
  committed base and misses uncommitted work.
- `tag:runtime:*` commands miss new projects until `pnpm run nx:reset`.
- Accounts are multi-role platform-wide (owner+renter+buyer+agent+provider simultaneously); never
  introduce a single-value `user_type` (PRD §11.2).
- **Deployment is gated in two registries, and omission is silent**: `skaffold.yaml` (local) and
  `infra/deploy-control.yaml` (CI/CD, enumerated by `yq` key lookup). A service missing from either
  never deploys, with no error. The CI image-build matrix is auto-derived from the `container-build`
  target — don't hardcode it.
- **`pnpm-lock.yaml` is Prettier-formatted here** (it's not in `.prettierignore`). Any
  `pnpm install` rewrites it in pnpm's native style and CI's format check fails — run
  `pnpm run nx:workspace-format` after installing, and confirm `pnpm install --frozen-lockfile`
  still exits 0.
- **No Alpine base images for anything doing in-cluster DNS.** musl fails Kubernetes service
  resolution with `EAI_AGAIN`; use a Debian `-slim` base. (`cribstop-next` is still on Alpine and
  has this latent bug.)
- **Kill background test processes when done.** `skaffold --port-forward` and `kubectl port-forward`
  outlive their command and squat on ports, or serve a stale pod so later checks pass against
  nothing. `pkill` does nothing on Windows — use `taskkill //F //IM kubectl.exe`.
- Jest `<rootDir>` inside `testMatch` / `testPathIgnorePatterns` silently matches nothing on Windows
  (native backslashes read as escapes). Write the patterns without it.
