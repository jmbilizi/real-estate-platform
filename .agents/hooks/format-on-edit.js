#!/usr/bin/env node
/**
 * PostToolUse hook (Edit|Write): formats the edited file with the repo's
 * own Prettier (root .prettierrc.js -> tools/node/configs/prettier-config.js)
 * so mid-session edits never drift from nx:workspace-format-check.
 *
 * Always exits 0 — formatting is best-effort and must never block edits.
 */
const path = require('path');
const { spawnSync } = require('child_process');

const FORMATTABLE = /\.(js|jsx|ts|tsx|json|md|yml|yaml|css|scss|html)$/i;

let input = '';
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  try {
    const filePath = JSON.parse(input)?.tool_input?.file_path ?? '';
    if (!filePath || !FORMATTABLE.test(filePath)) process.exit(0);

    const repoRoot = path.resolve(__dirname, '..', '..');

    // Only format files inside this repo — outside files (scratchpads, temp
    // dirs) would resolve a different/default Prettier config.
    const normalized = path.resolve(filePath).toLowerCase();
    if (!normalized.startsWith(repoRoot.toLowerCase() + path.sep)) process.exit(0);
    const prettierBin = require.resolve('prettier/bin/prettier.cjs', {
      paths: [repoRoot],
    });
    spawnSync(process.execPath, [prettierBin, '--write', '--ignore-unknown', filePath], {
      cwd: repoRoot,
      stdio: 'ignore',
      timeout: 15000,
    });
  } catch {
    // best-effort: never fail the edit
  }
  process.exit(0);
});
