# Git Hooks System

This document describes the Git hooks system used in the Polyglot monorepo.

## Overview

The hooks system provides two-tier validation before commits and pushes:

- **Pre-commit**: Fast checks (format + lint + type) — ~5-15s
- **Pre-push**: Full suite (format + lint + type + test + build) — ~30s-2min

**Key principle**: Checks are language-scoped based on **what files are staged/changed** — not what
projects exist. A developer committing only `.tsx` files will never trigger Python or .NET setup.

## Hooks

### Pre-Commit (`.husky/pre-commit` → `scripts/pre-commit.js`)

Runs on every `git commit`:

- Runs `nx:reset` to ensure clean Nx state
- Inspects **staged files** to determine which languages are involved
- Runs format + lint + type-check only for affected languages:
  - **Node.js/TypeScript**: always checked (formatting is workspace-wide)
  - **Python**: only if `.py`, `.pyx`, `.ipynb` etc. files are staged
  - **.NET**: only if `.cs`, `.vb`, `.csproj` etc. files are staged
- Re-stages files modified during the hook (line ending normalization)
- Blocks commit on failure

### Pre-Push (`.husky/pre-push` → `scripts/pre-push.js`)

Runs on every `git push`:

- Inspects **files changed in the push range** to determine which languages are involved
- Runs format + lint + type + test + build for affected languages
- On feature branches: checks only affected projects
- On base branches (main/dev/test): checks all projects of each affected language

### Post-Merge (`.husky/post-merge`)

Runs after `git merge` or `git pull`:

- Installs updated Node.js dependencies if `package.json` or `pnpm-lock.yaml` changed

## Setup

Hook files are committed in `.husky/` and activate automatically when you run `pnpm install` (Husky
is configured via the `prepare` script).

To install prerequisites (Husky + Node.js deps):

```bash
pnpm run hooks:setup
```

For language-specific tooling the hooks depend on:

```bash
pnpm run python:env    # Python (UV + venv) — only needed if working on Python projects
pnpm run dotnet:env    # .NET SDK — only needed if working on .NET projects
```

## Architecture

| File                         | Purpose                                       |
| ---------------------------- | --------------------------------------------- |
| `.husky/pre-commit`          | Entry point — calls `scripts/pre-commit.js`   |
| `.husky/pre-push`            | Entry point — calls `scripts/pre-push.js`     |
| `scripts/pre-commit.js`      | Full pre-commit logic with language detection |
| `scripts/pre-push.js`        | Full pre-push logic with language detection   |
| `tools/hooks/setup-hooks.js` | Installs Husky + Node.js prerequisites        |

## Formatting

Workspace-wide formatting uses Prettier directly (no Nx project graph required):

```bash
pnpm run nx:workspace-format        # Fix all formatting
pnpm run nx:workspace-format-check  # Check all formatting
```

Config is in `.prettierrc.js` (re-exports `tools/node/configs/prettier-config.js`).

## Troubleshooting

**Hook not running after clone**: Run `pnpm install` — it activates Husky automatically via the
`prepare` script.

**Python setup failing**: Only run `pnpm run python:env` if you are working on Python projects. The
hook will skip Python checks if no Python files are staged.

**.NET check failing with "SDK not found"**: Run `pnpm run dotnet:env`. If you are not working on
.NET files, the hook skips .NET checks automatically.

**Hook bypassed accidentally**: CI enforces the same checks — code that bypasses local hooks will
still be caught before merging. 2. Check that the hook scripts exist in the `.husky` directory 3.
Verify language-specific tools are installed 4. Run `pnpm run hooks:setup` to recreate the hook
configuration
