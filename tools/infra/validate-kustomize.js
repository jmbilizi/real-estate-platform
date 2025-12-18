#!/usr/bin/env node

/**
 * Kustomize Validation Script
 *
 * Automatically discovers all cloud providers in infra/k8s/ (excluding 'base').
 * Validates Kustomize manifests for all environments (dev, test, prod).
 * Used by git hooks (pre-commit, pre-push) and can be run manually.
 *
 * Usage:
 *   npm run infra:validate                 # All providers, all environments
 *   npm run infra:validate:dev             # All providers, dev only
 *   npm run infra:validate:test            # All providers, test only
 *   npm run infra:validate:prod            # All providers, prod only
 */

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✓ ${message}`, "green");
}

function logError(message) {
  log(`✗ ${message}`, "red");
}

function logWarning(message) {
  log(`⚠ ${message}`, "yellow");
}

function run(command, options = {}) {
  try {
    const result = execSync(command, {
      cwd: path.resolve(__dirname, "../.."),
      stdio: options.silent ? "pipe" : "inherit",
      encoding: "utf-8",
      ...options,
    });
    return { success: true, output: result };
  } catch (error) {
    return { success: false, error, output: error.stdout || error.stderr };
  }
}

function checkKustomize() {
  const result = run("kustomize version", { silent: true });
  if (!result.success) {
    logError("Kustomize not found");
    logWarning("Install: npm run infra:setup");
    return false;
  }
  return true;
}

function discoverProviders() {
  const infraDir = path.resolve(__dirname, "../..", "infra/k8s");

  if (!fs.existsSync(infraDir)) {
    return [];
  }

  const providers = [];
  const entries = fs.readdirSync(infraDir, { withFileTypes: true });

  for (const entry of entries) {
    // Any directory except 'base' is considered a provider
    if (entry.isDirectory() && entry.name !== "base") {
      providers.push(entry.name);
    }
  }

  return providers.sort();
}

function validateEnvironment(provider, env) {
  const envPath = `infra/k8s/${provider}/${env}`;

  // Check if kustomization.yaml exists
  if (
    !fs.existsSync(
      path.resolve(__dirname, "../..", envPath, "kustomization.yaml"),
    )
  ) {
    // Environment doesn't exist for this provider - skip silently
    return null;
  }

  log(`\nValidating ${provider}/${env}...`, "cyan");

  const result = run(`kustomize build ${envPath} --enable-alpha-plugins`, {
    silent: true,
  });

  if (result.success) {
    logSuccess(`${provider}/${env}: Kustomize build successful`);
    return true;
  } else {
    logError(`${provider}/${env}: Kustomize build failed`);
    if (result.output) {
      log(result.output, "red");
    }
    return false;
  }
}

function main() {
  const args = process.argv.slice(2);
  const targetEnv = args[0]; // dev, test, prod, or undefined (all)

  log("\n🔍 Validating Kustomize manifests...", "bright");

  // Check if Kustomize is installed
  if (!checkKustomize()) {
    process.exit(1);
  }

  // Discover all providers
  const providers = discoverProviders();

  if (providers.length === 0) {
    logWarning("No cloud providers found in infra/k8s/");
    logWarning(
      "Expected structure: infra/k8s/{provider}/{env}/kustomization.yaml",
    );
    process.exit(0);
  }

  log(`\nDiscovered providers: ${providers.join(", ")}\n`, "blue");

  // Auto-discover all environments across all providers
  const environments = new Set();
  if (targetEnv) {
    environments.add(targetEnv);
  } else {
    // Discover all environments by scanning provider directories
    for (const provider of providers) {
      const providerDir = path.resolve(
        __dirname,
        "../..",
        `infra/k8s/${provider}`,
      );
      if (fs.existsSync(providerDir)) {
        const entries = fs.readdirSync(providerDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name !== "cluster") {
            // Check if it has a kustomization.yaml
            const kustomizationPath = path.join(
              providerDir,
              entry.name,
              "kustomization.yaml",
            );
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

  // Loop through all providers and environments
  for (const provider of providers) {
    for (const env of envArray) {
      const result = validateEnvironment(provider, env);
      if (result !== null) {
        // null means environment doesn't exist, skip it
        results[`${provider}/${env}`] = result;
      }
    }
  }

  // Check if we found any environments to validate
  if (Object.keys(results).length === 0) {
    logWarning("No environments found to validate");
    logWarning(`Providers checked: ${providers.join(", ")}`);
    process.exit(0);
  }

  // Summary
  log("\n" + "=".repeat(80), "cyan");
  log("  Validation Summary", "bright");
  log("=".repeat(80), "cyan");

  let allPassed = true;
  for (const [key, passed] of Object.entries(results)) {
    if (passed) {
      logSuccess(`${key}: PASSED`);
    } else {
      logError(`${key}: FAILED`);
      allPassed = false;
    }
  }

  if (allPassed) {
    log("\n✅ All Kustomize validations passed\n", "green");
    log(
      `Validated ${Object.keys(results).length} environment(s) across ${providers.length} provider(s)\n`,
      "cyan",
    );
    process.exit(0);
  } else {
    log("\n❌ Some Kustomize validations failed\n", "red");
    logWarning("Fix the errors above and try again");
    process.exit(1);
  }
}

main();
