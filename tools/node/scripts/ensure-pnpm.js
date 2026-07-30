#!/usr/bin/env node
/**
 * Ensure pnpm is installed. If not present, installs it globally using the
 * version declared in package.json's "packageManager" field.
 *
 * Runs as the "preinstall" npm lifecycle hook so that anyone who accidentally
 * runs `npm install` gets pnpm installed automatically before npm proceeds.
 *
 * Cross-platform: Windows (PowerShell/CMD), macOS, Linux.
 */

const { execSync } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const isWindows = os.platform() === 'win32';
const shellOpt = { shell: isWindows ? true : false };

// npm's loglevel=silent suppresses lifecycle script stdio.
// Open the TTY directly so our messages always reach the terminal.
let ttyFd = null;
try {
  ttyFd = fs.openSync(isWindows ? 'CONOUT$' : '/dev/tty', 'w');
} catch {
  // Not in an interactive TTY (e.g. CI with no tty) — fall back to stderr.
}

function log(msg) {
  const line = msg + '\n';
  if (ttyFd !== null) {
    fs.writeSync(ttyFd, line);
  } else {
    process.stderr.write(line);
  }
}

function closeTTY() {
  if (ttyFd !== null) {
    try {
      fs.closeSync(ttyFd);
    } catch {}
    ttyFd = null;
  }
}

function getPnpmVersion() {
  try {
    const pkgPath = path.join(__dirname, '../../..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const spec = pkg.packageManager; // e.g. "pnpm@10.30.3"
    if (!spec || !spec.startsWith('pnpm@')) {
      throw new Error('"packageManager" field is not set to pnpm in package.json');
    }
    return spec.split('@')[1];
  } catch (err) {
    console.error('✗ Could not read pnpm version from package.json:', err.message);
    process.exit(1);
  }
}

function isPnpmInstalled() {
  try {
    execSync('pnpm --version', { stdio: 'ignore', ...shellOpt });
    return true;
  } catch {
    return false;
  }
}

function isCorepackAvailable() {
  try {
    execSync('corepack --version', { stdio: 'ignore', ...shellOpt });
    return true;
  } catch {
    return false;
  }
}

function isPnpmInCorepack() {
  try {
    execSync('corepack pnpm --version', { stdio: 'ignore', ...shellOpt });
    return true;
  } catch {
    return false;
  }
}

function ttyStdio() {
  // Route subprocess output directly to the TTY fd so it's always visible.
  return ttyFd !== null ? ['inherit', ttyFd, ttyFd] : 'inherit';
}

function installPnpm(version) {
  // Prefer Corepack (bundled with Node.js 16.9+) over npm install -g.
  if (isCorepackAvailable()) {
    log(`\n⚠️  pnpm is not in PATH.`);
    try {
      if (!isPnpmInCorepack()) {
        // Corepack doesn't have pnpm cached yet — install it.
        log(`📦 Installing pnpm@${version} via Corepack...\n`);
        execSync(`corepack install -g pnpm@${version}`, { stdio: ttyStdio(), ...shellOpt });
      } else {
        log(`📦 Enabling pnpm@${version} shim via Corepack...\n`);
      }
      execSync('corepack enable pnpm', { stdio: ttyStdio(), ...shellOpt });
      log('\n✓ pnpm enabled via Corepack!');
    } catch {
      log('✗ Corepack setup failed. Falling back to npm install -g...');
      execSync(`npm install -g pnpm@${version}`, { stdio: ttyStdio(), ...shellOpt });
      log('\n✓ pnpm installed via npm!');
    }
  } else {
    log(`\n⚠️  pnpm is not installed.`);
    log(`📦 Installing pnpm@${version} globally...\n`);
    try {
      execSync(`npm install -g pnpm@${version}`, { stdio: ttyStdio(), ...shellOpt });
      log('\n✓ pnpm installed successfully!');
    } catch {
      log('✗ Failed to install pnpm. Please install it manually:');
      log(`  npm install -g pnpm@${version}`);
      closeTTY();
      process.exit(1);
    }
  }
  // pnpm is now available — run the install automatically.
  runPnpmInstall();
}

function getNpmPackageArgs() {
  // npm_config_argv contains the original CLI args in npm v6-v10 lifecycle context.
  // e.g. `npm install express` → { remain: ['express'], cooked: ['install','express'] }
  try {
    const argv = JSON.parse(process.env.npm_config_argv || '{}');
    return (argv.remain || []).filter((a) => a && !a.startsWith('-'));
  } catch {
    return [];
  }
}

function runPnpmInstall() {
  // Forward any package names from `npm install <pkg>` → `pnpm add <pkg>`.
  // Plain `npm install` with no packages → `pnpm install`.
  const packages = getNpmPackageArgs();
  const cmd = packages.length > 0 ? `pnpm add ${packages.join(' ')}` : 'pnpm install';

  log(`\n🚀 Switching to: ${cmd}\n`);

  // Override loglevel to 'info' so pnpm reads its own config normally.
  // Override package-lock so pnpm can read/write pnpm-lock.yaml normally.
  const env = { ...process.env };
  env.npm_config_loglevel = 'info';
  env.npm_config_package_lock = 'true';
  try {
    execSync(cmd, { stdio: ttyStdio(), env, ...shellOpt });
  } catch {
    // pnpm failed — exit 1 so npm also aborts.
    closeTTY();
    process.exit(1);
  }
  // pnpm succeeded. Exit 1 to prevent npm from also running its install.
  closeTTY();
  process.exit(1);
}

function main() {
  // If already running under pnpm, the preinstall hook is legitimate — let it pass.
  // This prevents an infinite loop when pnpm install itself triggers preinstall.
  const agent = process.env.npm_config_user_agent || '';
  if (agent.startsWith('pnpm/')) return;

  // Global installs/operations (npm install -g, npm uninstall -g, etc.) are
  // unrelated to project package management — let npm handle them normally.
  if (process.env.npm_config_global === 'true') return;

  const required = getPnpmVersion();

  // Always ensure the corepack shim is active so `pnpm` is in the user's PATH
  // after this script runs. npm lifecycle context has corepack transparency
  // built-in, so `pnpm --version` succeeds here even without the shim.
  // `corepack enable pnpm` is idempotent — safe to run every time.
  if (isCorepackAvailable()) {
    try {
      execSync('corepack enable pnpm', { stdio: 'ignore', ...shellOpt });
    } catch {
      // Non-fatal — fall through to install fallback below if needed.
    }
  }

  if (isPnpmInstalled()) {
    const installed = execSync('pnpm --version', { encoding: 'utf-8', ...shellOpt }).trim();
    log(`\n⚠️  npm install detected — redirecting to pnpm ${installed} automatically...`);
    runPnpmInstall();
  } else {
    installPnpm(required);
  }
}

main();
