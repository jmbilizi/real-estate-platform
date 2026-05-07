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
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');

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

function validateEnvironment(provider, env) {
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
    return true;
  } else {
    logError(`${provider}/${env}: Kustomize build failed`);
    if (result.output) {
      log(result.output, 'red');
    }
    return false;
  }
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
  const targetEnv = args[0]; // dev, test, prod, or undefined (all)

  log('\n🔍 Validating Kustomize manifests...', 'bright');

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
      const result = validateEnvironment(provider, env);
      if (result !== null) {
        // null means environment doesn't exist, skip it
        results[`${provider}/${env}`] = result;

        // Hetzner-specific location validation
        if (provider === 'hetzner') {
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

main();
