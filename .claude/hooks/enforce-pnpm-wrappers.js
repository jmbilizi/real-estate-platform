#!/usr/bin/env node
/**
 * PreToolUse hook (Bash): enforces repo rule #1 — never run raw tool
 * commands; always use pnpm run / pnpm exec nx wrappers.
 * See .github/copilot-instructions.md "Always Use Project Scripts".
 *
 * Exit 0 = allow, exit 2 = block (stderr is shown to Claude).
 *
 * Known limitation (accepted): commands wrapped in quotes (e.g.
 * `bash -c "dotnet build"`) bypass matching — quoted text is stripped to
 * avoid false positives on commit messages and echoed prose. This is a
 * guardrail, not a security boundary.
 */

let input = '';
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  let command = '';
  try {
    command = JSON.parse(input)?.tool_input?.command ?? '';
  } catch {
    process.exit(0); // fail open on malformed input
  }

  // Strip quoted string literals so text arguments (commit messages, echo
  // strings) can't false-positive as real invocations.
  const stripped = command.replace(/"[^"]*"|'[^']*'/g, '""');

  // Split into command segments so each rule anchors to the start of an
  // actual invocation — prose mentioning a tool mid-sentence never matches,
  // and a compliant `uv run x` segment can't whitewash a raw call elsewhere.
  const segments = stripped.split(/&&|\|\||;|\|/);

  const rules = [
    {
      pattern: /^\s*npx\s+(eslint|tsc|jest|prettier)\b/,
      fix: 'pnpm exec nx lint|type-check|test <project> or pnpm run nx:workspace-format',
    },
    {
      pattern: /^\s*dotnet\s+(build|test|run|format|restore|publish)\b/,
      fix: 'pnpm exec nx build|test|lint|format <project> or pnpm run nx:dotnet-* (dotnet new is allowed for project creation)',
    },
    {
      pattern: /^\s*(pytest|flake8|mypy|black)\b/,
      fix: 'uv run <tool>, pnpm run python:check, or pnpm exec nx test <project>',
    },
    {
      pattern: /^\s*python3?\s+-m\s+(pytest|pip|flake8|mypy|black)\b/,
      fix: 'uv run <tool> / uv add (UV workspace manages all Python tooling)',
    },
    {
      pattern: /^\s*pip3?\s+install\b/,
      fix: 'uv add --project <path> <pkg> (UV workspace manages all Python deps)',
    },
    {
      pattern: /^\s*kubectl\s+(apply|create|delete|edit|patch|replace)\b/,
      fix: 'pnpm run skaffold:deploy / skaffold:delete / infra scripts (kubectl is inspection-only: get, logs, describe, port-forward)',
    },
    {
      pattern: /^\s*skaffold\s+(run|dev|build|delete|debug)\b/,
      fix: 'pnpm run skaffold / skaffold:deploy / skaffold:services (context safety + immutable-field handling)',
    },
    {
      pattern: /^\s*(npm|yarn)\s+(install|i|ci|run|test|add)\b/,
      fix: 'pnpm — this workspace is pnpm-only (packageManager pin in package.json)',
    },
    {
      pattern: /^\s*git\s+push\b.*(\s--force(-with-lease)?\b|\s-f\b)/,
      fix: 'never force-push in this repo (repo rule #4)',
    },
  ];

  for (const segment of segments) {
    for (const rule of rules) {
      if (rule.pattern.test(segment)) {
        process.stderr.write(
          `Blocked by repo convention (.github/copilot-instructions.md): raw tool command detected.\n` +
            `Command: ${command}\n` +
            `Use instead: ${rule.fix}\n`,
        );
        process.exit(2);
      }
    }
  }
  process.exit(0);
});
