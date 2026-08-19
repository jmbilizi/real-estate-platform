#!/usr/bin/env node

/**
 * Kustomize Validation Script
 *
 * Automatically discovers all cloud providers in infra/k8s/ (excluding 'base').
 * Validates Kustomize manifests for all environments (dev, test, prod).
 * Used by git hooks (pre-commit, pre-push) and can be run manually.
 *
 * Usage:
 *   pnpm run infra:validate                 # All providers, all environments
 *   pnpm run infra:validate:dev             # All providers, dev only
 *   pnpm run infra:validate:test            # All providers, test only
 *   pnpm run infra:validate:prod            # All providers, prod only
 *   pnpm run infra:validate:gateway-routes  # Only the gateway route ↔ deploy-control guard
 *
 * Two cross-checks run on top of the Kustomize build, and they are mirror images of each
 * other (see tools/infra/deploy-scope.js and tools/infra/gateway-routes.js):
 *
 *   - "will this workload deploy without permission?" — a rendered workload with no
 *     deploy-control entry.
 *   - "does the gateway advertise something that will never deploy here?" — a route file
 *     naming a service the target environment gates off (#22, #71).
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');
const { resolveDeployScope, describeProblems } = require('./deploy-scope');
const { loadRouteFiles, resolveGatewayRouteProblems } = require('./gateway-routes');

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✓ ${message}`, 'green');
}

function logError(message) {
  log(`✗ ${message}`, 'red');
}

function logWarning(message) {
  log(`⚠ ${message}`, 'yellow');
}

function run(command, options = {}) {
  try {
    const result = execSync(command, {
      cwd: path.resolve(__dirname, '../..'),
      stdio: options.silent ? 'pipe' : 'inherit',
      encoding: 'utf-8',
      ...options,
    });
    return { success: true, output: result };
  } catch (error) {
    return { success: false, error, output: error.stdout || error.stderr };
  }
}

function checkKustomize() {
  const result = run('kustomize version', { silent: true });
  if (!result.success) {
    logError('Kustomize not found');
    logWarning('Install: pnpm run infra:setup');
    return false;
  }
  return true;
}

function discoverProviders() {
  const infraDir = path.resolve(__dirname, '../..', 'infra/k8s');

  if (!fs.existsSync(infraDir)) {
    return [];
  }

  const providers = [];
  const entries = fs.readdirSync(infraDir, { withFileTypes: true });

  for (const entry of entries) {
    // Any directory except 'base' is considered a provider
    if (entry.isDirectory() && entry.name !== 'base') {
      providers.push(entry.name);
    }
  }

  return providers.sort();
}

function validateEnvironment(provider, env, only = null) {
  const envPath = `infra/k8s/${provider}/${env}`;

  // Check if kustomization.yaml exists
  if (!fs.existsSync(path.resolve(__dirname, '../..', envPath, 'kustomization.yaml'))) {
    // Environment doesn't exist for this provider - skip silently
    return null;
  }

  log(`\nValidating ${provider}/${env}...`, 'cyan');

  const result = run(`kustomize build ${envPath} --enable-alpha-plugins`, {
    silent: true,
  });

  if (result.success) {
    logSuccess(`${provider}/${env}: Kustomize build successful`);

    if (provider === 'hetzner' && only !== 'gateway-routes') {
      const problems = findDeployControlProblems(result.output, env);
      if (
        !reportProblems(
          problems,
          `${provider}/${env}`,
          'manifests and infra/deploy-control.yaml disagree',
        )
      ) {
        return false;
      }
      logSuccess(`${provider}/${env}: deploy-control accounts for every workload`);
    }

    // Runs for every provider: without a deploy-control block (podman/local) only the
    // downstream host/port resolution applies, which is still the difference between a
    // working local gateway and a 502.
    const gatewayProblems = findGatewayRouteProblems(result.output, env);
    if (
      !reportProblems(
        gatewayProblems,
        `${provider}/${env}`,
        'gateway routes and infra/deploy-control.yaml disagree',
      )
    ) {
      return false;
    }
    logSuccess(`${provider}/${env}: every advertised gateway route is deployable`);

    return true;
  } else {
    logError(`${provider}/${env}: Kustomize build failed`);
    if (result.output) {
      log(result.output, 'red');
    }
    return false;
  }
}

/** Print a problem list. Returns true when there was nothing to print. */
function reportProblems(problems, label, headline) {
  if (problems.length === 0) {
    return true;
  }
  logError(`${label}: ${headline}`);
  for (const problem of problems) {
    log(`  ${problem.headline}:`, 'red');
    for (const item of problem.items) {
      log(`    - ${item}`, 'red');
    }
    for (const line of problem.detail) {
      log(`    ${line}`, 'yellow');
    }
  }
  return false;
}

function loadManifestDocuments(manifest) {
  const documents = [];
  yaml.loadAll(manifest, (document) => {
    if (document) {
      documents.push(document);
    }
  });
  return documents;
}

/**
 * Cross-check a rendered environment against infra/deploy-control.yaml using the SAME
 * rule the deploy action applies (tools/infra/deploy-scope.js). Deliberately ignores
 * `enabled` / `auto_deploy`: a service being switched off is a decision, not drift — only
 * the registry KEYS matter here. Both directions are checked, so a stale or typo'd key is
 * caught before it fails a lane in the cluster with a misleading diagnosis.
 */
function findDeployControlProblems(manifest, environment) {
  const controlPath = path.resolve(__dirname, '../..', 'infra/deploy-control.yaml');
  const control = yaml.load(fs.readFileSync(controlPath, 'utf-8'));
  const registeredKeys = Object.keys(control?.environments?.[environment]?.services ?? {});

  if (registeredKeys.length === 0) {
    return [
      {
        headline: `deploy-control.yaml has no environments.${environment}.services entries`,
        detail: ['Every environment rendered under infra/k8s/hetzner must declare its services.'],
        items: [environment],
      },
    ];
  }

  const result = resolveDeployScope({
    documents: loadManifestDocuments(manifest),
    registeredKeys,
  });

  return describeProblems(result, { mode: 'validate' });
}

/**
 * Cross-check what the api-gateway ADVERTISES against what the environment DEPLOYS — the
 * inverse of `findDeployControlProblems`, and the failure that only a human in a browser
 * ever found (#22, #71). See tools/infra/gateway-routes.js for the resolution rule.
 *
 * `control` is passed as null for providers with no deploy-control block (podman/local), in
 * which case only the downstream host/port resolution is enforced.
 */
function findGatewayRouteProblems(manifest, environment) {
  const controlPath = path.resolve(__dirname, '../..', 'infra/deploy-control.yaml');
  const control = yaml.load(fs.readFileSync(controlPath, 'utf-8'));
  const hasEnvironmentBlock =
    Object.keys(control?.environments?.[environment]?.services ?? {}).length > 0;

  return resolveGatewayRouteProblems({
    routeFiles: loadRouteFiles(),
    documents: loadManifestDocuments(manifest),
    control: hasEnvironmentBlock ? control : null,
    environment,
  });
}

function validateHetznerLocation(env) {
  const basePath = path.resolve(__dirname, '../..', 'infra/k8s/hetzner', env);
  const clusterConfigPath = path.join(basePath, 'cluster/cluster-config.yaml');
  const serviceYamlPath = path.join(
    basePath,
    'patches/services/ingress-nginx-controller.service.yaml',
  );

  // Skip if cluster config doesn't exist (optional check)
  if (!fs.existsSync(clusterConfigPath)) {
    return { valid: true, skipped: true, reason: 'No cluster config' };
  }

  if (!fs.existsSync(serviceYamlPath)) {
    return { valid: true, skipped: true, reason: 'No ingress controller service patch' };
  }

  try {
    // Extract cluster location
    const clusterConfig = yaml.load(fs.readFileSync(clusterConfigPath, 'utf-8'));

    // hetzner-k3s uses masters_pool.locations (array) for cluster location
    const clusterLocation = clusterConfig.masters_pool?.locations?.[0];

    if (!clusterLocation) {
      return { valid: false, error: 'No location found in masters_pool.locations' };
    }

    // Extract load balancer location
    const serviceYaml = yaml.load(fs.readFileSync(serviceYamlPath, 'utf-8'));
    const lbLocation = serviceYaml.metadata?.annotations?.['load-balancer.hetzner.cloud/location'];

    if (!lbLocation) {
      return { valid: false, error: 'No load-balancer.hetzner.cloud/location annotation found' };
    }

    // Compare locations
    if (clusterLocation !== lbLocation) {
      return {
        valid: false,
        error: `Location mismatch: cluster=${clusterLocation}, load-balancer=${lbLocation}`,
        clusterLocation,
        lbLocation,
        serviceYamlPath,
      };
    }

    return { valid: true, clusterLocation, lbLocation };
  } catch (error) {
    return { valid: false, error: `Validation error: ${error.message}` };
  }
}

function main() {
  const args = process.argv.slice(2);
  // `--only gateway-routes` narrows the sweep to the gateway route ↔ deploy-control guard
  // (pnpm run infra:validate:gateway-routes). Everything still renders through Kustomize —
  // the guard reads the rendered Services and the api-gateway Deployment.
  const onlyIndex = args.indexOf('--only');
  const only = onlyIndex === -1 ? null : args[onlyIndex + 1];
  const targetEnv = args.filter(
    (arg, index) => !arg.startsWith('--') && index !== onlyIndex + 1,
  )[0]; // dev, test, prod, or undefined (all)

  log(
    only === 'gateway-routes'
      ? '\n🔍 Validating gateway routes against infra/deploy-control.yaml...'
      : '\n🔍 Validating Kustomize manifests...',
    'bright',
  );

  // Check if Kustomize is installed
  if (!checkKustomize()) {
    process.exit(1);
  }

  // Discover all providers
  const providers = discoverProviders();

  if (providers.length === 0) {
    logWarning('No cloud providers found in infra/k8s/');
    logWarning('Expected structure: infra/k8s/{provider}/{env}/kustomization.yaml');
    process.exit(0);
  }

  log(`\nDiscovered providers: ${providers.join(', ')}\n`, 'blue');

  // Auto-discover all environments across all providers
  const environments = new Set();
  if (targetEnv) {
    environments.add(targetEnv);
  } else {
    // Discover all environments by scanning provider directories
    for (const provider of providers) {
      const providerDir = path.resolve(__dirname, '../..', `infra/k8s/${provider}`);
      if (fs.existsSync(providerDir)) {
        const entries = fs.readdirSync(providerDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name !== 'cluster') {
            // Check if it has a kustomization.yaml
            const kustomizationPath = path.join(providerDir, entry.name, 'kustomization.yaml');
            if (fs.existsSync(kustomizationPath)) {
              environments.add(entry.name);
            }
          }
        }
      }
    }
  }

  const envArray = Array.from(environments).sort();
  const results = {};
  const hetznerLocationResults = {};

  // Loop through all providers and environments
  for (const provider of providers) {
    for (const env of envArray) {
      const result = validateEnvironment(provider, env, only);
      if (result !== null) {
        // null means environment doesn't exist, skip it
        results[`${provider}/${env}`] = result;

        // Hetzner-specific location validation
        if (provider === 'hetzner' && only !== 'gateway-routes') {
          const locationResult = validateHetznerLocation(env);
          hetznerLocationResults[env] = locationResult;
        }
      }
    }
  }

  // Check if we found any environments to validate
  if (Object.keys(results).length === 0) {
    logWarning('No environments found to validate');
    logWarning(`Providers checked: ${providers.join(', ')}`);
    process.exit(0);
  }

  // Summary
  log('\n' + '='.repeat(80), 'cyan');
  log('  Validation Summary', 'bright');
  log('='.repeat(80), 'cyan');

  let allPassed = true;
  for (const [key, passed] of Object.entries(results)) {
    if (passed) {
      logSuccess(`${key}: PASSED`);
    } else {
      logError(`${key}: FAILED`);
      allPassed = false;
    }
  }

  // Hetzner location validation summary
  if (Object.keys(hetznerLocationResults).length > 0) {
    log('\n' + '='.repeat(80), 'cyan');
    log('  Hetzner Location Consistency', 'bright');
    log('='.repeat(80), 'cyan');

    for (const [env, result] of Object.entries(hetznerLocationResults)) {
      if (result.skipped) {
        logWarning(`hetzner/${env}: SKIPPED (${result.reason})`);
      } else if (result.valid) {
        logSuccess(`hetzner/${env}: Locations match (${result.clusterLocation})`);
      } else {
        logError(`hetzner/${env}: ${result.error}`);
        if (result.serviceYamlPath) {
          log(`  Fix: Update ${path.relative(process.cwd(), result.serviceYamlPath)}`, 'yellow');
          log(
            `  Change annotation to: load-balancer.hetzner.cloud/location: ${result.clusterLocation}`,
            'yellow',
          );
        }
        allPassed = false;
      }
    }
  }

  if (allPassed) {
    log('\n✅ All validations passed\n', 'green');
    log(
      `Validated ${Object.keys(results).length} environment(s) across ${providers.length} provider(s)\n`,
      'cyan',
    );
    process.exit(0);
  } else {
    log('\n❌ Some validations failed\n', 'red');
    logWarning('Fix the errors above and try again');
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { findDeployControlProblems, findGatewayRouteProblems, loadManifestDocuments };
