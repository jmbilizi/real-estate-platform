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

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
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
  addToPath,
  migrateLegacyEnvMarkers,
  installBinary,
} = require('../lib/binary-installer');

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

  migrateLegacyEnvMarkers();

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
