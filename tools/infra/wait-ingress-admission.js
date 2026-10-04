#!/usr/bin/env node
// Skaffold after-deploy hook of the `ingress-nginx` module (#101). It blocks until the
// ingress-nginx admission webhook can answer. The webhook is `failurePolicy: Fail` on Ingress
// CREATE and UPDATE, so an Ingress applied before this point is rejected.

const { spawnSync } = require('child_process');

const NAMESPACE = 'ingress-nginx';
const TIMEOUT = process.env.INGRESS_ADMISSION_TIMEOUT || '180s';

function kubectl(args) {
  // Skaffold exports the context it deploys to. Fall back to the current context.
  const context = process.env.SKAFFOLD_KUBE_CONTEXT;
  const contextArgs = context ? ['--context', context] : [];
  const result = spawnSync('kubectl', [...contextArgs, '-n', NAMESPACE, ...args], {
    stdio: 'inherit',
    shell: false,
  });
  return result.status === 0;
}

/** The steps, in order. Each is one kubectl call that exits non-zero on timeout. */
function waitSteps(timeout) {
  return [
    ['rollout', 'status', 'deployment/ingress-nginx-controller', `--timeout=${timeout}`],
    // These Jobs create the webhook certificate and patch its caBundle.
    [
      'wait',
      '--for=condition=complete',
      'job/ingress-nginx-admission-create',
      'job/ingress-nginx-admission-patch',
      `--timeout=${timeout}`,
    ],
    // A Ready controller is the only endpoint behind the admission Service.
    [
      'wait',
      '--for=jsonpath={.subsets[0].addresses[0].ip}',
      'endpoints/ingress-nginx-controller-admission',
      `--timeout=${timeout}`,
    ],
  ];
}

function main() {
  for (const step of waitSteps(TIMEOUT)) {
    if (!kubectl(step)) {
      console.error(`ERROR: ingress-nginx admission is not ready (kubectl ${step.join(' ')}).`);
      process.exit(1);
    }
  }
  console.log('ingress-nginx admission webhook is ready.');
}

if (require.main === module) {
  main();
}

module.exports = { waitSteps };
