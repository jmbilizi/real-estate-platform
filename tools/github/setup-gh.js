#!/usr/bin/env node

/**
 * GitHub CLI setup — separate from tools/infra/setup-infra.js because `gh` has nothing to do
 * with the Kubernetes/local-cluster tooling that script manages. Installs `gh` the same way
 * (GitHub-release binary into ~/.local/bin) and checks auth status for the gh:ticket:* scripts.
 *
 * Usage:
 *   pnpm run gh:setup
 */

const path = require('path');
const { logStep, log, ok, info, C, run, installBinary, EXT } = require('../lib/binary-installer');

const GH_VERSION = '2.63.0';

// cli/cli release archives use "macOS" (not "darwin") in their asset names, and unlike
// kustomize/skaffold/kind/kubectl they ship the binary nested under `<archive-root>/bin/`.
function ghReleasePlatform(platform) {
  return platform === 'darwin' ? 'macOS' : platform;
}

function ghArchiveRoot(platform, arch) {
  return `gh_${GH_VERSION}_${ghReleasePlatform(platform)}_${arch}`;
}

function ghUrl(platform, arch) {
  const ext = platform === 'windows' || platform === 'darwin' ? '.zip' : '.tar.gz';
  return `https://github.com/cli/cli/releases/download/v${GH_VERSION}/${ghArchiveRoot(platform, arch)}${ext}`;
}

// Unlike the macOS/Linux archives (which nest the binary under a versioned
// `gh_<version>_<platform>_<arch>/bin/` root), the Windows zip extracts flat —
// `bin/gh.exe` sits at the archive root with no version-named parent folder.
function ghArchiveBinaryPath(platform, arch) {
  return platform === 'windows'
    ? path.join('bin', `gh${EXT}`)
    : path.join(ghArchiveRoot(platform, arch), 'bin', `gh${EXT}`);
}

async function main() {
  logStep('GitHub CLI Setup');

  const ghReady = await installBinary({
    name: 'GitHub CLI',
    binary: 'gh',
    version: GH_VERSION,
    url: ghUrl,
    isArchive: true,
    archiveBinaryPath: ghArchiveBinaryPath,
    versionArgs: ['--version'],
  });

  if (!ghReady) process.exit(1);

  const authCheck = run('gh', ['auth', 'status']);
  if (authCheck.success) {
    ok('gh is authenticated');
  } else {
    log('\nNext step — authenticate the GitHub CLI (required for gh:ticket:* commands):', C.cyan);
    info('  gh auth login');
  }

  log('');
  process.exit(0);
}

main().catch((err) => {
  log(`✗ Unexpected error: ${err.message}`, C.red);
  process.exit(1);
});
