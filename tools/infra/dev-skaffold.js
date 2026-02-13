#!/usr/bin/env node

/*
 * Cross-platform Skaffold dev launcher.
 *
 * Why this exists:
 * - On Windows, running `npm run skaffold` uses npm.cmd, and Ctrl+C can trigger
 *   the interactive `Terminate batch job (Y/N)?` prompt.
 * - Running the wrapper via `node` avoids the batch wrapper entirely.
 *
 * Usage:
 *   node tools/infra/dev-skaffold.js
 *   node tools/infra/dev-skaffold.js -- <extra skaffold args>
 */

const { spawn } = require("child_process");
const path = require("path");

const workspaceRoot = path.resolve(__dirname, "../..");

const extraArgsIndex = process.argv.indexOf("--");
const extraArgs = extraArgsIndex >= 0 ? process.argv.slice(extraArgsIndex + 1) : [];

const child = spawn(process.execPath, ["tools/infra/run-skaffold.js", "dev", "--port-forward", ...extraArgs], {
  cwd: workspaceRoot,
  stdio: "inherit",
  windowsHide: true,
});

child.on("exit", (code, signal) => {
  if (typeof code === "number") {
    process.exit(code);
  }
  if (signal) {
    process.exit(1);
  }
  process.exit(1);
});
