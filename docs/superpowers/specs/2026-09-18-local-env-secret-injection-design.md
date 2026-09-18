# Local `.env` secret injection for the podman/local cluster

Date: 2026-09-18 Status: design approved, not implemented

## Problem

A developer cannot supply a real external credential to the local cluster without editing a
committed secret manifest. `tools/infra/run-skaffold.js` performs no secret substitution. Every
local deploy applies the committed `StrongBase64Password` placeholders as-is. To test Bright MLS
ingestion, or transactional email when #133 lands, a developer must hand-edit
`infra/k8s/base/secrets/*.secret.yaml` and then remember not to commit it.

CI has no such problem. `.github/actions/deploy-k8s-resources/action.yml` substitutes GitHub Secrets
into the same manifests before `kubectl apply`. Local development must gain the same capability,
with the same result, and with no new way to leak a credential into Git.

## Current state

The deploy action performs two unrelated substitutions. Only the first is in scope.

| Family            | Mechanism                       | Targets                                            | In scope |
| ----------------- | ------------------------------- | -------------------------------------------------- | -------- |
| A — secret values | `yq` into `.stringData.<KEY>`   | `infra/k8s/base/secrets/*.secret.yaml`             | yes      |
| B — ingress hosts | `sed` of `*_DOMAIN_PLACEHOLDER` | `infra/k8s/hetzner/<env>/patches/ingresses/*.yaml` | no       |

Family A covers 12 keys today: four postgres passwords, five Redis ACL passwords, the jaeger `auth`
blob, and the two Bright MLS credentials. `KUBECONFIG` is an action input, not a substitution.

Family B applies only to Hetzner overlays. The podman/local overlay hardcodes `*.localhost` hosts
and contains no placeholder tokens. `JAEGER_DOMAIN`, `API_GATEWAY_DOMAIN` and `CRIBSTOP_DOMAIN` are
therefore irrelevant locally.

Two existing facts anchor the implementation:

- `infra/k8s/.gitignore` line 10 ignores `podman/.generated/`. `run-skaffold.js` already writes a
  generated overlay there for the `services-only` module.
- Node is pinned to 20.19.5, so `process.loadEnvFile()` is available. No `dotenv` dependency.

## Decisions

1. **Scope**: every Family A key is injectable. A key that `.env` omits or leaves empty keeps the
   value committed in the manifest.
2. **Key registry**: derived from the secret manifests. No hand-maintained list.
3. **Injection**: Kustomize strategic-merge patches written to the generated overlay directory. The
   working tree is never modified.
4. **CI**: gated for drift, not refactored.
5. **Consumers**: cluster Secrets only. Processes outside the cluster keep using the cluster's
   existing wiring.

Decision 2 makes the `DOMAIN` and `KUBECONFIG` exclusion structural. Those values do not appear in
any secret manifest, so a derivation over `stringData` cannot return them.

## Components

### 1. `tools/infra/secret-keys.js` — source of truth

Reads every `infra/k8s/base/secrets/*.secret.yaml`. Returns one record per `stringData` key:
`{ file, secretName, key }`.

Every `stringData` key is injectable. The module does not match the `StrongBase64Password` sentinel.
This covers the jaeger `auth` key, whose value is not a password, and survives a future rename of
the placeholder text.

The module handles multi-document YAML files and files with no `stringData` block.

### 2. `.env.example` — generated and drift-checked

`tools/infra/generate-env-example.js` renders `.env.example` from the derivation. The file contains
one commented block per secret manifest, bare `KEY=` lines, and a header that states the
override-or-fallback rule.

`.env.example` is a rendered view, never the registry. No tool learns key names by reading it.

`pnpm run infra:validate` fails when `.env.example` does not match the derivation. That command
already runs in CI's `validate-infra` job and in both git hooks. This follows the repo rule that
generated files are committed and derived from disk, never hand-listed.

`.env.example` carries key names and comments only. It never carries a realistic sample value.

### 3. `.env` — developer-supplied overrides

`.gitignore` line 60 already ignores `.env`.

`run-skaffold.js` loads it with `process.loadEnvFile()`. A variable already present in the real
environment wins over the file, so a shell export or a CI variable still overrides.

### 4. Injection into the local render

When `.env` supplies at least one key, `run-skaffold.js` writes one strategic-merge patch per
affected secret manifest to `infra/k8s/podman/.generated/secrets/<name>.secret.yaml`. Each patch
contains only the keys that `.env` actually supplied. The script then layers those patches over the
local overlay.

Kustomize strategic-merges `stringData` key by key. An omitted key therefore keeps the committed
base value with no conditional code. This delivers decision 1 directly, and it cannot blank a key. A
`yq` assignment would need a per-key `if [ -n "$VAR" ]` guard, which is the fragile part of the CI
step and the origin of its half-credential edge case.

When `.env` is absent, or supplies no key, the script generates nothing and leaves the manifest
paths unchanged. The render stays byte-identical to today.

The generation must compose with the existing `services-only` profile, which repoints
`manifests.kustomize.paths` in `skaffold.yaml`.

Real values reach `infra/k8s/podman/.generated/` only. That directory is git-ignored, so
`git status` stays clean after a deploy.

### 5. CI drift gate

The deploy action keeps its current hand-written form. It fronts every dev, test and prod deploy, so
a restructure carries risk that this work does not need to take.

A new check asserts that three sets of key names are equal:

1. keys derived from the secret manifests,
2. keys the action substitutes, parsed from its `yq eval '.stringData.X = env(X)'` lines,
3. keys the workflow `env:` block passes to the action.

Drift fails `pnpm run infra:validate`. The action can no longer disagree silently with the manifests
or with `.env.example`.

Family B and `KUBECONFIG` are untouched.

Collapsing the 12 `yq` lines into a loop is a separate ticket. This gate proves equivalence before
that change is attempted.

### 6. Guardrails

- The tooling logs key names and a count, never a value. Example:
  `overriding 4 of 12 keys: BRIGHT_MLS_CLIENT_ID, ...`
- Real values are written only under `infra/k8s/podman/.generated/`.
- A pre-commit guard fails when a staged `infra/k8s/base/secrets/*.secret.yaml` carries a
  `stringData` value that is not the placeholder. This catches a hand-edit and an accidental
  working-tree overwrite.

## Interactions

**Postmark (#133)** has no secret manifest yet. Because the manifest is the source of truth, the
local path works as soon as `postmark.secret.yaml` lands. `.env.example` regenerates and no further
wiring is needed.

**#58** asks a human to supply a local `DATABASE_URL` for `property_db`. Local postgres passwords
become injectable under this design, and an in-cluster `DATABASE_URL` already exists. #58 is
probably closable as obsolete. The product owner decides.

## Testing

- `tools/infra/secret-keys.test.js`: derivation over fixtures, including a manifest with no
  `stringData` and a multi-document manifest.
- Generator idempotence: a second run of `generate-env-example.js` changes nothing.
- Drift gate: a fixture where the action and the manifests disagree exits non-zero.
- Manual, no `.env`: `pnpm run skaffold:services:deploy` renders a `kustomize build` byte-identical
  to the current output.
- Manual, one key set: a `.env` that sets `BRIGHT_MLS_CLIENT_ID` renders that value, and
  `BRIGHT_MLS_CLIENT_SECRET` still renders the committed placeholder.

## Out of scope

- Domain substitution (Family B) and `KUBECONFIG`.
- Kustomize `secretGenerator` and `secrets.env` files. The repo forbids both.
- Collapsing the CI `yq` lines into a loop.
- Hetzner overlays.
- Feeding `.env` to processes that run outside the cluster.
