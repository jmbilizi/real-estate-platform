# Unified Git Hooks

This directory contains the unified Git hooks system for the Polyglot monorepo.

## Quick Start

Git hooks are automatically set up when you run `npm install` (via the `prepare` script).

## Available Scripts

## Current Hooks

- **pre-commit** (`.husky/pre-commit`): Runs quick validation (format + lint + type check)
- **pre-push** (`.husky/pre-push`): Runs full validation (format + lint + type check + test + build)

## Documentation

For detailed documentation, see [the hooks documentation](./docs/README.md).
