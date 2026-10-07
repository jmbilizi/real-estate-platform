/**
 * Shared cross-platform single-binary installer (Windows/macOS/Linux, no shell-specific
 * commands). Downloads a tool's GitHub-release binary into `~/.local/bin` and adds it to this process PATH,
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
    // Windows 10+ ships bsdtar, which extracts zip files.
    const r = run('tar', ['-xf', zipPath, '-C', destDir]);
    if (!r.success) throw new Error('Failed to extract zip');
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
 * Add a directory to PATH for this process, and to GITHUB_PATH when set (CI).
 * This function never writes the registry, a shell profile, or any other persistent setting.
 * It prints the entry for the developer to add by hand.
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

  process.env.PATH = `${binDir}${sep}${process.env.PATH}`;
  if (process.env.GITHUB_PATH) {
    try {
      fs.appendFileSync(process.env.GITHUB_PATH, `${binDir}\n`);
      ok('Added to GITHUB_PATH');
    } catch (e) {
      warn(`Could not write GITHUB_PATH: ${e.message}`);
    }
  }
  warn(`PATH is changed for this run only. To keep it, add "${binDir}" to your PATH yourself.`);
  if (IS_WIN) {
    info('Windows: Settings > "Edit environment variables for your account" > Path > New.');
  } else {
    info(`Or run: echo 'export PATH="${binDir}:$PATH"' >> ~/.profile`);
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
  resolveArch,
  releasePlatform,
  installBinary,
};
