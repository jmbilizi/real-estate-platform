#!/usr/bin/env node

/**
 * Infrastructure Development Setup Script
 *
 * Detects and installs required infrastructure tools for local K8s development.
 * Fully cross-platform (Windows, macOS, Linux) — no shell-specific commands.
 *
 * Tools managed:
 *   • Podman   — Container runtime (detect + PATH fix; manual install required)
 *   • Kustomize — Kubernetes manifest templating
 *   • Skaffold  — Local K8s dev workflow (watch / build / deploy)
 *   • kind      — Kubernetes-in-Docker for local clusters
 *   • kubectl   — Kubernetes CLI
 *
 * Usage:
 *   pnpm run infra:setup
 *   node tools/infra/setup-infra.js
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const https = require('https');
const http = require('http');
const path = require('path');
const os = require('os');

// ─── Constants ───────────────────────────────────────────────────────────────

const PLATFORM = os.platform(); // win32 | darwin | linux
const ARCH = os.arch(); // x64 | arm64
const IS_WIN = PLATFORM === 'win32';
const BIN_DIR = path.join(os.homedir(), '.local', 'bin');
const EXT = IS_WIN ? '.exe' : '';

// ─── Logging ─────────────────────────────────────────────────────────────────

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

// ─── Shared Helpers ──────────────────────────────────────────────────────────

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
        if (r.success) ok('Added to Windows User PATH (permanent)');
        else warn(`Failed to update User PATH — manually add "${binDir}"`);
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
    // Unix: update shell profile
    const profile = (process.env.SHELL || '').includes('zsh')
      ? path.join(os.homedir(), '.zshrc')
      : path.join(os.homedir(), '.bashrc');
    const exportLine = `export PATH="${binDir}:$PATH"`;

    try {
      const content = fs.existsSync(profile) ? fs.readFileSync(profile, 'utf8') : '';
      if (!content.includes(binDir)) {
        fs.appendFileSync(profile, `\n# Infrastructure tools (setup-infra.js)\n${exportLine}\n`);
        ok(`Added to ${profile}`);
      }
    } catch (e) {
      warn(`Could not update ${profile}: ${e.message}`);
    }

    // Also update current process so subsequent checks in this run work
    process.env.PATH = `${binDir}${sep}${process.env.PATH}`;
  }
}

/** Get the arch string for release URLs (amd64 | arm64). */
function resolveArch() {
  return ARCH === 'arm64' ? 'arm64' : 'amd64';
}

/** Get the platform string for release URLs (windows | darwin | linux). */
function releasePlatform() {
  return PLATFORM === 'win32' ? 'windows' : PLATFORM;
}

// ─── Generic Binary Installer ────────────────────────────────────────────────

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
 */
async function installBinary(spec) {
  const { name, binary, version, url: urlFn, versionArgs = ['version'], isArchive = false } = spec;
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

      const extracted = path.join(tempDir, binaryName);
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

    ok(`${name} installed to ${binaryPath} — restart terminal if not yet available`);
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

// ─── Podman (detect-only — cannot be auto-installed as a CLI binary) ─────────

function ensurePodman() {
  // --version is client-only (no daemon connection needed)
  const quick = run('podman', ['--version']);
  if (quick.success) {
    const ver = quick.output.match(/[\d.]+/)?.[0] || 'unknown';
    ok(`Podman already in PATH: ${ver}`);
    return true;
  }

  // Probe well-known install locations per platform
  const candidates = [];
  if (IS_WIN) {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    candidates.push(
      path.join(localAppData, 'Programs', 'Podman'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'RedHat', 'Podman'),
    );
  } else if (PLATFORM === 'darwin') {
    candidates.push('/opt/podman/bin', '/opt/homebrew/bin', '/usr/local/bin');
  } else {
    candidates.push('/usr/bin', '/usr/local/bin');
  }

  const binaryName = `podman${EXT}`;
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, binaryName))) {
      log(`Found Podman at ${path.join(dir, binaryName)} (not on PATH)`, C.yellow);
      addToPath(dir);
      const verify = run('podman', ['--version']);
      if (verify.success) {
        ok(`Podman ${verify.output.match(/[\d.]+/)?.[0] || ''} added to PATH`);
        return true;
      }
      ok('Podman PATH updated — restart your terminal if not yet available');
      return true;
    }
  }

  fail('Podman is not installed');
  if (IS_WIN) warn('Install: winget install RedHat.Podman');
  else if (PLATFORM === 'darwin') warn('Install: brew install podman');
  else warn('See https://podman.io/docs/installation#linux');
  warn('Or install Podman Desktop: https://podman-desktop.io/');
  return false;
}

// ─── Tool Versions ───────────────────────────────────────────────────────────

const KUSTOMIZE_VERSION = '5.6.0';
const SKAFFOLD_VERSION = '2.13.2';
const KIND_VERSION = '0.26.0';
const KUBECTL_VERSION = '1.31.0';

function kustomizeUrl(platform, arch) {
  const ext = platform === 'windows' ? '.zip' : '.tar.gz';
  return `https://github.com/kubernetes-sigs/kustomize/releases/download/kustomize%2Fv${KUSTOMIZE_VERSION}/kustomize_v${KUSTOMIZE_VERSION}_${platform}_${arch}${ext}`;
}

function skaffoldUrl(platform, arch) {
  const ext = platform === 'windows' ? '.exe' : '';
  return `https://github.com/GoogleContainerTools/skaffold/releases/download/v${SKAFFOLD_VERSION}/skaffold-${platform}-${arch}${ext}`;
}

function kindUrl(platform, arch) {
  const ext = platform === 'windows' ? '.exe' : '';
  return `https://github.com/kubernetes-sigs/kind/releases/download/v${KIND_VERSION}/kind-${platform}-${arch}${ext}`;
}

function kubectlUrl(platform, arch) {
  const ext = platform === 'windows' ? '.exe' : '';
  return `https://dl.k8s.io/release/v${KUBECTL_VERSION}/bin/${platform}/${arch}/kubectl${ext}`;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  logStep('Infrastructure Development Setup');
  log('');
  info(`Platform: ${PLATFORM}/${ARCH}`);
  info(`Bin dir:  ${BIN_DIR}`);
  log('');
  info('Tools to set up:');
  info('  • Podman     — Container runtime (detect / PATH fix)');
  info('  • Kustomize  — Kubernetes manifest templating');
  info('  • Skaffold   — Local K8s dev workflow');
  info('  • kind       — Kubernetes-in-Docker clusters');
  info('  • kubectl    — Kubernetes CLI');
  log('');

  logStep('Podman');
  const podmanReady = ensurePodman();

  logStep('Kustomize');
  const kustomizeReady = await installBinary({
    name: 'Kustomize',
    binary: 'kustomize',
    version: KUSTOMIZE_VERSION,
    url: kustomizeUrl,
    isArchive: true,
  });

  logStep('Skaffold');
  const skaffoldReady = await installBinary({
    name: 'Skaffold',
    binary: 'skaffold',
    version: SKAFFOLD_VERSION,
    url: skaffoldUrl,
  });

  logStep('kind');
  const kindReady = await installBinary({
    name: 'kind',
    binary: 'kind',
    version: KIND_VERSION,
    url: kindUrl,
  });

  logStep('kubectl');
  const kubectlReady = await installBinary({
    name: 'kubectl',
    binary: 'kubectl',
    version: KUBECTL_VERSION,
    url: kubectlUrl,
    versionArgs: ['version', '--client'],
  });

  // ── Summary ──
  logStep('Summary');
  const results = [
    ['Podman', podmanReady],
    ['Kustomize', kustomizeReady],
    ['Skaffold', skaffoldReady],
    ['kind', kindReady],
    ['kubectl', kubectlReady],
  ];

  let allGood = true;
  for (const [name, ready] of results) {
    if (ready) ok(`${name} is ready`);
    else {
      fail(`${name} is NOT ready`);
      allGood = false;
    }
  }

  logStep('Next Steps');

  if (!podmanReady) {
    log('\n0. Install Podman (required for local cluster):', C.cyan);
    info('   https://podman-desktop.io/');
    info('   Then re-run: pnpm run infra:setup');
  }

  log('\n1. Set up local K8s cluster:', C.cyan);
  info('   pnpm run infra:local:cluster:setup');

  log('\n2. Start local development (watch + build + deploy):', C.cyan);
  info('   pnpm run skaffold');

  log('\n3. Validate Kustomize manifests:', C.cyan);
  info('   pnpm run infra:validate');

  log('\n4. Git hooks auto-validate on commit/push\n', C.cyan);

  process.exit(allGood ? 0 : 1);
}

main().catch((err) => {
  fail(`Unexpected error: ${err.message}`);
  process.exit(1);
});
