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

## Commands (repo level)

```bash
pnpm run skaffold:services             # Backend services in local K8s
pnpm exec nx lint <project>            # Single project: lint | test | type-check
pnpm run nx:node-lint                  # Bulk by language: nx:{node|dotnet|python}-{target}
pnpm run nx:workspace-format           # Fix formatting repo-wide
pnpm run pre-commit                    # Fast validation (format+lint+type-check)
pnpm run pre-push                      # Full validation (+ test + build)
pnpm install && pnpm run hooks:setup   # First-time setup
pnpm run infra:local:cluster:setup     # Local Kind/Podman cluster
```

## Layout

- `apps/` — deployable projects (gateway, services, clients); `libs/` — shared libraries (created on
  demand via Nx generators).
- `infra/k8s/` — ALL K8s manifests (Kustomize base + per-env overlays).
- `tools/` — cross-platform Node automation scripts (source of truth).

## Repo-Wide Gotchas

- Test a changed project directly by name (`pnpm exec nx test <project>`); `nx affected` needs a
  committed base and misses uncommitted work.
- `tag:runtime:*` commands miss new projects until `pnpm run nx:reset`.
- Accounts are multi-role platform-wide (owner+renter+buyer+agent+provider simultaneously); never
  introduce a single-value `user_type` (PRD §11.2).
