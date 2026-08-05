# Unified Git Hooks

This directory contains the unified Git hooks system for the Polyglot monorepo.

## Quick Start

Git hooks are automatically set up when you run `pnpm install` (via the `prepare` script).

## Available Scripts

## Current Hooks

- **pre-commit** (`.husky/pre-commit`): Runs quick validation (format + lint + type check)
- **pre-push** (`.husky/pre-push`): Runs full validation (format + lint + type check + test + build)

Both hooks auto-enforce only on protected branches (`dev`, `test`, `main`). On feature branches they
exit immediately — an intentional speed-up: run `pnpm run pre-commit` once, then make several
commits without re-waiting for it, or use targeted format/lint/type-check commands for small obvious
changes. Run `pnpm run pre-push` before pushing.

## Documentation

For detailed documentation, see [the hooks documentation](./docs/README.md).
