#!/usr/bin/env node

/**
 * Python Development Environment Setup Script
 *
 * This script sets up the Python development environment for the Polyglot monorepo.
 * It provides a "single command from zero" experience:
 *
 * 1. Checks for UV installation and installs if needed (cross-platform)
 * 2. Runs `uv sync` to create .venv and install all workspace dependencies
 * 3. Verifies the environment is working
 *
 * Usage:
 *   node python-dev-setup.js [options]
 *
 *   Options:
 *     --help, -h       Display this help message
 *     --check          Only check if environment is set up (no installation)
 *     --all-extras     Install all optional dependency groups
 *
 * UV handles:
 *   - Python installation (auto-downloads version from .python-version)
 *   - Virtual environment creation (.venv at workspace root)
 *   - Package installation from uv.lock (deterministic)
 *   - Workspace member linking (apps/services/*)
 */

const path = require('path');
const { spawnSync, execSync } = require('child_process');
const os = require('os');
const fs = require('fs');

// Process command line arguments
const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const allExtras = args.includes('--all-extras');

if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node python-dev-setup.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --help, -h       Display this help message');
  console.log('  --check          Only check if environment is set up (no installation)');
  console.log('  --all-extras     Install all optional dependency groups');
  console.log('');
  console.log('Description:');
  console.log('  Sets up the Python development environment using UV (workspace shared venv).');
  console.log(
    '  Installs UV if not present, then runs `uv sync` to create .venv and install packages.',
  );
  console.log('');
  console.log('Actions:');
  console.log('  1. Checks for UV installation (installs if missing)');
  console.log('  2. Runs `uv sync` to create .venv + install all packages');
  console.log('  3. Verifies key tools are available (black, flake8, mypy, pytest)');
  process.exit(0);
}

// Determine OS
const isWindows = os.platform() === 'win32';
const isMacOS = os.platform() === 'darwin';

// Define paths
const rootDir = process.cwd();
const venvPath = path.join(rootDir, '.venv');
const venvBinDir = isWindows ? path.join(venvPath, 'Scripts') : path.join(venvPath, 'bin');

// Logging helper
function log(message, isError = false) {
  if (isError) {
    console.error(`[ERROR] ${message}`);
  } else {
    console.log(`[INFO] ${message}`);
  }
}

// Execute a command and return result
function execute(cmd, args = [], options = {}) {
  const result = spawnSync(cmd, args, {
    stdio: options.silent ? 'pipe' : 'inherit',
    shell: true,
    cwd: options.cwd || rootDir,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
  });

  return {
    status: result.status,
    success: result.status === 0,
    stdout: result.stdout ? result.stdout.trim() : '',
    stderr: result.stderr ? result.stderr.trim() : '',
    error: result.error,
  };
}

// Check if UV is installed and available
function isUvInstalled() {
  const result = execute('uv', ['--version'], { silent: true });
  if (result.success && result.stdout) {
    return result.stdout;
  }
  // Check stderr too — UV sometimes outputs version to stderr
  if (result.success && result.stderr) {
    return result.stderr;
  }
  return null;
}

// Install UV using the official installer (cross-platform)
function installUv() {
  log('UV not found. Installing UV...');

  if (isWindows) {
    // Windows: use the official PowerShell installer
    log('Installing UV via official PowerShell installer...');
    const result = execute('powershell', [
      '-ExecutionPolicy',
      'ByPass',
      '-NoProfile',
      '-Command',
      'irm https://astral.sh/uv/install.ps1 | iex',
    ]);

    if (!result.success) {
      // Fallback: try winget
      log('PowerShell installer failed. Trying winget...');
      const wingetResult = execute('winget', [
        'install',
        '--id',
        'astral-sh.uv',
        '--accept-source-agreements',
        '--accept-package-agreements',
      ]);

      if (!wingetResult.success) {
        log('Failed to install UV via winget.', true);
        log(
          'Please install UV manually: https://docs.astral.sh/uv/getting-started/installation/',
          true,
        );
        return false;
      }
    }

    // The official installer adds UV to PATH via USERPROFILE/.local/bin
    // Refresh PATH for current process
    refreshWindowsPath();
  } else if (isMacOS) {
    // macOS: try brew first, fall back to official installer
    const brewCheck = execute('brew', ['--version'], { silent: true });
    if (brewCheck.success) {
      log('Installing UV via Homebrew...');
      const result = execute('brew', ['install', 'uv']);
      if (!result.success) {
        log('Homebrew install failed. Trying official installer...');
        return installUvCurl();
      }
    } else {
      return installUvCurl();
    }
  } else {
    // Linux: use official curl installer
    return installUvCurl();
  }

  // Verify installation
  const version = isUvInstalled();
  if (version) {
    log(`UV installed successfully: ${version}`);
    return true;
  }

  log("UV installation completed but 'uv' is not yet in PATH.", true);
  log('You may need to restart your terminal, then run this script again.', true);
  return false;
}

// Install UV via curl (macOS/Linux)
function installUvCurl() {
  log('Installing UV via official installer...');
  const result = execute('sh', ['-c', 'curl -LsSf https://astral.sh/uv/install.sh | sh']);

  if (!result.success) {
    log('Failed to install UV.', true);
    log(
      'Please install UV manually: https://docs.astral.sh/uv/getting-started/installation/',
      true,
    );
    return false;
  }

  // Source the env file to get UV in PATH for current process
  const cargoEnv = path.join(os.homedir(), '.local', 'bin');
  if (fs.existsSync(cargoEnv)) {
    process.env.PATH = `${cargoEnv}:${process.env.PATH}`;
  }

  return true;
}

// Refresh Windows PATH to pick up newly installed tools
function refreshWindowsPath() {
  try {
    // Read current user PATH from registry
    const result = spawnSync(
      'powershell',
      ['-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('PATH', 'User')"],
      { shell: true, encoding: 'utf8', stdio: 'pipe' },
    );

    if (result.status === 0 && result.stdout) {
      const userPath = result.stdout.trim();
      const currentPath = process.env.PATH || '';

      // Add any new directories to current process PATH
      const currentDirs = new Set(currentPath.split(';').map((d) => d.toLowerCase()));
      const newDirs = userPath.split(';').filter((d) => d && !currentDirs.has(d.toLowerCase()));

      if (newDirs.length > 0) {
        process.env.PATH = `${newDirs.join(';')};${currentPath}`;
        log(`Added ${newDirs.length} new PATH entries for current session.`);
      }
    }
  } catch (error) {
    log(`Could not refresh PATH: ${error.message}`, true);
  }
}

// Run uv sync to create/update the virtual environment
function syncEnvironment() {
  log('Running uv sync to create/update virtual environment...');

  const syncArgs = ['sync'];
  if (allExtras) {
    syncArgs.push('--all-extras');
  }

  const result = execute('uv', syncArgs);
  if (!result.success) {
    log('Failed to run uv sync.', true);
    return false;
  }

  log('Virtual environment synced successfully.');
  return true;
}

// Verify that key Python tools are available
function verifyTools() {
  log('\nVerifying Python development tools...');

  const tools = [
    { name: 'black', args: ['--version'] },
    { name: 'flake8', args: ['--version'] },
    { name: 'mypy', args: ['--version'] },
    { name: 'pytest', args: ['--version'] },
    { name: 'ruff', args: ['--version'] },
  ];

  let allOk = true;
  for (const tool of tools) {
    const result = execute('uv', ['run', tool.name, ...tool.args], {
      silent: true,
    });
    if (result.success) {
      const version = result.stdout || result.stderr || 'ok';
      // Extract just the first line for cleaner output
      const firstLine = version.split('\n')[0].trim();
      console.log(`  ✓ ${tool.name}: ${firstLine}`);
    } else {
      console.log(`  ✗ ${tool.name}: NOT AVAILABLE`);
      allOk = false;
    }
  }

  return allOk;
}

// Check-only mode: report environment status
function checkEnvironment() {
  console.log('\n=== Python Environment Status ===\n');

  // Check UV
  const uvVersion = isUvInstalled();
  if (uvVersion) {
    console.log(`  ✓ UV: ${uvVersion}`);
  } else {
    console.log('  ✗ UV: NOT INSTALLED');
    console.log("\n  Run 'pnpm run python:env' to set up the environment.");
    process.exit(1);
  }

  // Check .python-version
  const pyVersionFile = path.join(rootDir, '.python-version');
  if (fs.existsSync(pyVersionFile)) {
    const pyVersion = fs.readFileSync(pyVersionFile, 'utf8').trim();
    console.log(`  ✓ .python-version: ${pyVersion}`);
  } else {
    console.log('  ✗ .python-version: NOT FOUND');
  }

  // Check pyproject.toml
  const pyprojectFile = path.join(rootDir, 'pyproject.toml');
  if (fs.existsSync(pyprojectFile)) {
    console.log('  ✓ pyproject.toml: exists');
  } else {
    console.log('  ✗ pyproject.toml: NOT FOUND');
  }

  // Check uv.lock
  const uvLock = path.join(rootDir, 'uv.lock');
  if (fs.existsSync(uvLock)) {
    console.log('  ✓ uv.lock: exists');
  } else {
    console.log('  ✗ uv.lock: NOT FOUND');
  }

  // Check .venv
  const pythonExe = path.join(venvBinDir, isWindows ? 'python.exe' : 'python');
  if (fs.existsSync(venvPath) && fs.existsSync(pythonExe)) {
    console.log('  ✓ .venv: exists');
  } else {
    console.log('  ✗ .venv: NOT FOUND');
    console.log("\n  Run 'pnpm run python:env' to create it.");
    process.exit(1);
  }

  // Check tools
  console.log('');
  const toolsOk = verifyTools();

  console.log(
    toolsOk
      ? '\n✅ Python environment is fully set up!'
      : "\n⚠️  Some tools are missing. Run 'pnpm run python:env' to fix.",
  );
  process.exit(toolsOk ? 0 : 1);
}

// =============================================================================
// Main
// =============================================================================
function main() {
  console.log('\n=== Python Development Environment Setup ===\n');

  // Check-only mode
  if (checkOnly) {
    checkEnvironment();
    return;
  }

  // Step 1: Check/Install UV
  let uvVersion = isUvInstalled();
  if (uvVersion) {
    log(`UV is already installed: ${uvVersion}`);
  } else {
    if (!installUv()) {
      log('Cannot proceed without UV.', true);
      process.exit(1);
    }
    uvVersion = isUvInstalled();
  }

  // Step 2: Verify pyproject.toml exists
  const pyprojectFile = path.join(rootDir, 'pyproject.toml');
  if (!fs.existsSync(pyprojectFile)) {
    log('No pyproject.toml found at workspace root.', true);
    log('This file is required for UV workspace mode.', true);
    process.exit(1);
  }

  // Step 3: Run uv sync
  if (!syncEnvironment()) {
    log('Environment setup failed.', true);
    process.exit(1);
  }

  // Step 4: Verify tools
  const toolsOk = verifyTools();

  // Done
  console.log(
    toolsOk
      ? '\n✅ Python development environment is ready!'
      : '\n⚠️  Environment created but some tools may be missing.',
  );
  console.log('\nUseful commands:');
  console.log('  uv run <tool>           Run a tool in the venv (e.g., uv run pytest)');
  console.log('  uv add <package>        Add a dependency to the workspace');
  console.log('  pnpm run python:format   Format all Python code');
  console.log('  pnpm run python:lint     Lint all Python code');
  console.log('  pnpm run python:check    Format + lint');
  console.log('  pnpm run python:env -- --check   Check environment status');
}

main();
