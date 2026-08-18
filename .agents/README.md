# .agents/ — Provider-Neutral Agentic Assets

Single source of truth for the repo's AI-agent automation, consumable by multiple providers (Claude
Code, GitHub Copilot / VS Code, and future ones like Codex) with thin per-provider adapters.
Repo-wide instructions live separately in the root `AGENTS.md` (plus nested per-project `AGENTS.md`
files) — the [agents.md](https://agents.md/) open standard.

## Layout

| Path                     | What                                                              |
| ------------------------ | ----------------------------------------------------------------- |
| `skills/<name>/SKILL.md` | Skills per the [agentskills.io](https://agentskills.io/) standard |
| `agents/<name>.md`       | Subagent definitions (Claude sub-agent frontmatter format)        |
| `hooks/*.js`             | Provider-neutral hook scripts (stdin JSON in, exit code out)      |

## How each provider consumes this

| Provider        | Skills                               | Subagents                                   | Hooks                                 | Instructions                       |
| --------------- | ------------------------------------ | ------------------------------------------- | ------------------------------------- | ---------------------------------- |
| VS Code Copilot | `.agents/skills/` (native)           | via `chat.agentFilesLocations` (`.vscode/`) | not yet (VS Code hooks are preview)   | `AGENTS.md` root + nested (native) |
| Claude Code     | generated `.claude/skills/` pointers | generated `.claude/agents/` copies          | registered in `.claude/settings.json` | `CLAUDE.md` stubs `@AGENTS.md`     |
| Codex (future)  | map in sync script when adopted      | map in sync script when adopted             | n/a                                   | `AGENTS.md` root + nested (native) |

## Rules

- **Edit canonical files here, never the generated ones.** After any change under `.agents/`, run
  `pnpm run agents:sync` and commit the regenerated `.claude/` files alongside.
  `pnpm run agents:check` (wired into pre-commit) fails on drift or orphans.
- **Project-specific skills** nest the same shape inside the project (e.g.
  `apps/clients/cribstop/.agents/skills/<name>/`). The sync script discovers nested `.agents/` dirs
  automatically; also register the new location in `.vscode/settings.json` →
  `chat.agentSkillsLocations` so VS Code Copilot picks it up.
- Skill directory names: lowercase-hyphen, ≤64 chars, must equal the frontmatter `name` — the sync
  script validates this (a mismatch makes providers silently drop the skill).
- Hook scripts must stay provider-neutral: read the tool payload from stdin, communicate via exit
  code + stderr, no Claude-specific APIs. Provider registration (matchers, timeouts) lives in that
  provider's own config file, not here. Git hooks (husky) remain the universal backstop for the same
  rules.

## Adding a provider

1. Instructions: nothing to do if it reads `AGENTS.md` (most do). Otherwise add a stub in its format
   that defers to `AGENTS.md`.
2. Skills/subagents: if it discovers `.agents/` natively (or supports a configurable location),
   configure that; otherwise add a mapping to `tools/agents/sync-providers.js` that emits its format
   from the canonical files.
3. Hooks: register `.agents/hooks/*.js` in the provider's hook config if it has one.
