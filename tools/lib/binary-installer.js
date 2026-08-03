/**
 * Shared cross-platform single-binary installer (Windows/macOS/Linux, no shell-specific
 * commands). Downloads a tool's GitHub-release binary into `~/.local/bin` and persists PATH,
 * or detects an existing install already on PATH.
 *
 * Used by domain-specific setup scripts (tools/infra/setup-infra.js for kustomize/skaffold/
 * kind/kubectl, tools/github/setup-gh.js for gh) — kept here rather than in any one domain's
 * script since the tools it installs aren't all infra-related.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const https = require('https');
const http = require('http');
const path = require('path');
const os = require('os');

const PLATFORM = os.platform(); // win32 | darwin | linux
const ARCH = os.arch(); // x64 | arm64
const IS_WIN = PLATFORM === 'win32';
const BIN_DIR = path.join(os.homedir(), '.local', 'bin');
const EXT = IS_WIN ? '.exe' : '';

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

const log = (msg, c = '') => console.log(`${c}${msg}${C.reset}`);
const logStep = (s) => {
  log(`\n${'='.repeat(80)}`, C.cyan);
  log(`  ${s}`, C.bold);
  log('='.repeat(80), C.cyan);
};
const ok = (m) => log(`✓ ${m}`, C.green);
const warn = (m) => log(`⚠ ${m}`, C.yellow);
const fail = (m) => log(`✗ ${m}`, C.red);
const info = (m) => log(`  ${m}`, C.blue);

/** Run a command synchronously. Returns { success, output }. */
function run(cmd, args = [], opts = {}) {
  const result = spawnSync(cmd, args, {
    encoding: 'utf-8',
    stdio: 'pipe',
    shell: false,
    ...opts,
  });
  return {
    success: result.status === 0,
    output: (result.stdout || '') + (result.stderr || ''),
  };
}

/** Download a URL to a local file path. Follows redirects (up to 10). */
function download(url, dest) {
  return new Promise((resolve, reject) => {
    const get = url.startsWith('https') ? https.get : http.get;
    const attempt = (targetUrl, depth = 0) => {
      if (depth > 10) return reject(new Error('Too many redirects'));
      get(targetUrl, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return attempt(res.headers.location, depth + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${targetUrl}`));
        }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', reject);
      }).on('error', reject);
    };
    attempt(url);
  });
}

/** Extract a .zip archive (cross-platform). */
async function extractZip(zipPath, destDir) {
  if (IS_WIN) {
    const r = run('powershell', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force`,
    ]);
    if (!r.success) throw new Error('Expand-Archive failed');
  } else {
    // macOS has bsdtar that can handle zips; try unzip first, tar as fallback
    let r = run('unzip', ['-o', zipPath, '-d', destDir]);
    if (!r.success) {
      r = run('tar', ['-xf', zipPath, '-C', destDir]);
      if (!r.success) throw new Error('Failed to extract zip');
    }
  }
}

/** Extract a .tar.gz archive. */
async function extractTarGz(archivePath, destDir) {
  const r = run('tar', ['-xzf', archivePath, '-C', destDir]);
  if (!r.success) throw new Error('tar extraction failed');
}

/**
 * Add a directory to PATH:
 *   Windows — persists to User PATH via registry, refreshes current process
 *   Unix    — appends to shell profile + updates current process
 */
function addToPath(binDir) {
  const sep = path.delimiter;
  const norm = (p) =>
    p
      .trim()
      .toLowerCase()
      .replace(/[/\\]+$/, '');
  const target = norm(binDir);
  const currentDirs = process.env.PATH.split(sep).map(norm).filter(Boolean);

  if (currentDirs.includes(target)) {
    ok('Already in PATH');
    return;
  }

  if (IS_WIN) {
    // Read User PATH from registry
    const cur = run('powershell', [
      '-NoProfile',
      '-Command',
      "[System.Environment]::GetEnvironmentVariable('PATH','User')",
    ]);
    if (cur.success) {
      const existing = cur.output.trim().split(';').map(norm).filter(Boolean);
      if (!existing.includes(target)) {
        const r = run('powershell', [
          '-NoProfile',
          '-Command',
          `[System.Environment]::SetEnvironmentVariable('PATH','${binDir};' + [System.Environment]::GetEnvironmentVariable('PATH','User'),'User')`,
        ]);
        if (r.success) {
          ok('Added to Windows User PATH (permanent)');
          warn('Restart this terminal for the PATH change to take effect.');
        } else warn(`Failed to update User PATH — manually add "${binDir}"`);
      }
    }

    // Refresh current process PATH from registry (Machine + User)
    const refresh = run('powershell', [
      '-NoProfile',
      '-Command',
      "[System.Environment]::GetEnvironmentVariable('PATH','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('PATH','User')",
    ]);
    if (refresh.success && refresh.output) {
      process.env.PATH = refresh.output.trim();
    }
  } else {
    // Unix: update shell profiles and install an auto-refresh hook so the new
    // PATH takes effect at the next prompt without closing the terminal.
    const home = os.homedir();
    const shell = process.env.SHELL || '';
    const isZsh = shell.includes('zsh');
    const triggerFile = path.join(home, '.dev-tools-env-refresh');

    const profiles = isZsh
      ? [path.join(home, '.zshrc'), path.join(home, '.zprofile')]
      : [path.join(home, '.bashrc'), path.join(home, '.bash_profile')];

    const pathMarker = '# Added by tools/lib/binary-installer.js';
    const exportLine = `export PATH="${binDir}:$PATH"`;
    const pathBlock = `\n${pathMarker}\n${exportLine}\n`;

    const hookMarker = '# dev-tools env auto-refresh hook';
    const zshHook = `
${hookMarker}
_dev_tools_env_refresh() {
  local trigger="$HOME/.dev-tools-env-refresh"
  if [ -f "$trigger" ]; then
    rm -f "$trigger"
    source "$HOME/.zshrc"
  fi
}
precmd_functions+=(_dev_tools_env_refresh)
`;
    const bashHook = `
${hookMarker}
_dev_tools_env_refresh() {
  local trigger="$HOME/.dev-tools-env-refresh"
  if [ -f "$trigger" ]; then
    rm -f "$trigger"
    source "$HOME/.bashrc"
  fi
}
PROMPT_COMMAND="_dev_tools_env_refresh\${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
`;
    const hook = isZsh ? zshHook : bashHook;

    for (const profile of profiles) {
      try {
        const existing = fs.existsSync(profile) ? fs.readFileSync(profile, 'utf8') : '';
        let content = existing;
        let changed = false;

        if (!existing.includes(binDir)) {
          content += pathBlock;
          changed = true;
          ok(`Added PATH entry to ${profile}`);
        }

        if (!existing.includes(hookMarker)) {
          content += hook;
          changed = true;
          ok(`Added auto-refresh hook to ${profile}`);
        }

        if (changed) fs.writeFileSync(profile, content, 'utf8');
      } catch (e) {
        warn(`Could not update ${profile}: ${e.message}`);
      }
    }

    // Write trigger file — the hook above detects it at the next shell prompt
    // and sources the profile, making the new tool available without reopening
    // the terminal.
    try {
      fs.writeFileSync(triggerFile, '', 'utf8');
      ok('Terminal PATH will refresh automatically at the next prompt.');
    } catch (e) {
      warn(`Could not write refresh trigger: ${e.message}`);
    }

    // Also update current process so subsequent checks in this run work
    process.env.PATH = `${binDir}${sep}${process.env.PATH}`;
  }
}

// Marker/hook/trigger names used before this installer logic was extracted out of
// tools/infra/setup-infra.js into this shared module (when it was still infra-specific).
const LEGACY_PATH_MARKER = '# Added by infra:setup';
const LEGACY_HOOK_MARKER = '# infra:setup auto-refresh hook';
const LEGACY_TRIGGER_FILE = path.join(os.homedir(), '.infra-env-refresh');

/**
 * One-time cleanup for machines that already ran the pre-extraction `infra:setup` and have the
 * old marker/hook block in their shell profile. Without this, they'd end up with both the old
 * and new auto-refresh hooks installed side by side the next time a tool needs a PATH update.
 * Windows has no profile-file markers (PATH is persisted via the registry), so this is a no-op
 * there. Safe to call unconditionally — it's a no-op once migrated.
 */
function migrateLegacyEnvMarkers() {
  if (IS_WIN) return;

  const home = os.homedir();
  const profiles = [
    path.join(home, '.zshrc'),
    path.join(home, '.zprofile'),
    path.join(home, '.bashrc'),
    path.join(home, '.bash_profile'),
  ];

  for (const profile of profiles) {
    if (!fs.existsSync(profile)) continue;
    let content;
    try {
      content = fs.readFileSync(profile, 'utf8');
    } catch {
      continue;
    }
    if (!content.includes(LEGACY_PATH_MARKER) && !content.includes(LEGACY_HOOK_MARKER)) continue;

    const lines = content.split('\n');
    const kept = [];
    let skipping = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === LEGACY_PATH_MARKER) {
        skipping = 'path';
        continue;
      }
      if (skipping === 'path') {
        skipping = false; // the single `export PATH=...` line right after the marker
        continue;
      }
      if (trimmed === LEGACY_HOOK_MARKER) {
        skipping = 'hook';
        continue;
      }
      if (skipping === 'hook') {
        if (trimmed.startsWith('precmd_functions+=') || trimmed.startsWith('PROMPT_COMMAND=')) {
          skipping = false;
        }
        continue;
      }
      kept.push(line);
    }

    try {
      fs.writeFileSync(profile, kept.join('\n'), 'utf8');
      ok(`Migrated legacy env markers out of ${profile}`);
    } catch (e) {
      warn(`Could not migrate legacy markers in ${profile}: ${e.message}`);
    }
  }

  try {
    if (fs.existsSync(LEGACY_TRIGGER_FILE)) fs.unlinkSync(LEGACY_TRIGGER_FILE);
  } catch {}
}

/** Get the arch string for release URLs (amd64 | arm64). */
function resolveArch() {
  return ARCH === 'arm64' ? 'arm64' : 'amd64';
}

/** Get the platform string for release URLs (windows | darwin | linux). */
function releasePlatform() {
  return PLATFORM === 'win32' ? 'windows' : PLATFORM;
}

/**
 * Install a single-binary tool into BIN_DIR.
 *
 * @param {object} spec
 * @param {string} spec.name        — Display name
 * @param {string} spec.binary      — Binary filename (no extension)
 * @param {string} spec.version     — Version string (no "v" prefix)
 * @param {function} spec.url       — (platform, arch) => download URL
 * @param {string[]} [spec.versionArgs] — Args to verify install (default: ['version'])
 * @param {boolean} [spec.isArchive]    — true if download is zip/tar.gz
 * @param {function} [spec.archiveBinaryPath] — (platform, arch) => path of the binary inside the
 *   extracted archive, relative to the archive root (default: the binary filename itself, i.e.
 *   the archive is flat). Use when a tool ships its binary nested in a subfolder (e.g. `gh`).
 */
async function installBinary(spec) {
  const {
    name,
    binary,
    version,
    url: urlFn,
    versionArgs = ['version'],
    isArchive = false,
    archiveBinaryPath,
  } = spec;
  const binaryName = `${binary}${EXT}`;
  const binaryPath = path.join(BIN_DIR, binaryName);

  // 1. Already on PATH and working?
  const check = run(binaryName, versionArgs);
  if (check.success) {
    const ver = check.output.match(/v?[\d.]+/)?.[0] || 'unknown';
    ok(`${name} already installed: ${ver}`);
    return true;
  }

  // 2. Binary exists in BIN_DIR but not on PATH?
  if (fs.existsSync(binaryPath)) {
    log(`${name} found at ${binaryPath} but not in PATH`, C.yellow);
    addToPath(BIN_DIR);
    const recheck = run(binaryName, versionArgs);
    if (recheck.success) {
      ok(`${name} is now on PATH`);
      return true;
    }
  }

  // 3. Download and install
  const downloadUrl = urlFn(releasePlatform(), resolveArch());
  fs.mkdirSync(BIN_DIR, { recursive: true });

  try {
    log(`Downloading ${name} v${version}...`, C.blue);

    if (isArchive) {
      const isZip = downloadUrl.endsWith('.zip');
      const ext = isZip ? '.zip' : '.tar.gz';
      const archivePath = path.join(BIN_DIR, `${binary}${ext}`);
      const tempDir = path.join(BIN_DIR, `${binary}-temp`);

      await download(downloadUrl, archivePath);
      fs.mkdirSync(tempDir, { recursive: true });

      if (isZip) await extractZip(archivePath, tempDir);
      else await extractTarGz(archivePath, tempDir);

      const relPath = archiveBinaryPath
        ? archiveBinaryPath(releasePlatform(), resolveArch())
        : binaryName;
      const extracted = path.join(tempDir, relPath);
      if (!fs.existsSync(extracted)) throw new Error(`${binaryName} not found in archive`);
      fs.renameSync(extracted, binaryPath);

      // Cleanup
      try {
        fs.unlinkSync(archivePath);
      } catch {}
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    } else {
      await download(downloadUrl, binaryPath);
    }

    // Make executable on Unix
    if (!IS_WIN) fs.chmodSync(binaryPath, 0o755);

    addToPath(BIN_DIR);

    const verify = run(binaryName, versionArgs);
    if (verify.success) {
      ok(`${name} v${version} installed`);
      return true;
    }

    if (IS_WIN)
      warn(`${name} installed to ${binaryPath} — restart this terminal for PATH to take effect.`);
    else ok(`${name} installed to ${binaryPath} — PATH will refresh at next prompt.`);
    return true;
  } catch (err) {
    fail(`Failed to install ${name}: ${err.message}`);
    try {
      if (fs.existsSync(binaryPath)) fs.unlinkSync(binaryPath);
    } catch {}

    warn('Manual install alternatives:');
    if (IS_WIN) warn(`  Windows: choco install ${binary}`);
    if (PLATFORM === 'darwin') warn(`  macOS:   brew install ${binary}`);
    warn(`  Download: ${downloadUrl}`);
    return false;
  }
}

module.exports = {
  PLATFORM,
  ARCH,
  IS_WIN,
  BIN_DIR,
  EXT,
  C,
  log,
  logStep,
  ok,
  warn,
  fail,
  info,
  run,
  download,
  extractZip,
  extractTarGz,
  addToPath,
  migrateLegacyEnvMarkers,
  resolveArch,
  releasePlatform,
  installBinary,
};
