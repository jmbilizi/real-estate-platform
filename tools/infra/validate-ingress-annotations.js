#!/usr/bin/env node

/**
 * Validates Kustomize ingress configurations to detect annotation conflicts
 * between base and patches.
 *
 * Pattern: Base has common operational annotations (WebSocket, session affinity).
 * Patches add only environment-specific annotations (cert-manager, security headers).
 *
 * Fails if: Patch redefines same annotation key as base (silent override bug).
 * Runs as part of pre-commit hook.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const INGRESS_BASE_DIR = path.join(__dirname, '../../infra/k8s/base/ingresses');
const INGRESS_PATCH_DIRS = [
  path.join(__dirname, '../../infra/k8s/podman/local/patches/ingresses'),
  path.join(__dirname, '../../infra/k8s/hetzner/dev/patches/ingresses'),
  path.join(__dirname, '../../infra/k8s/hetzner/test/patches/ingresses'),
  path.join(__dirname, '../../infra/k8s/hetzner/prod/patches/ingresses'),
];

/**
 * Extract annotations from an ingress YAML file
 */
function getAnnotations(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const doc = yaml.load(content);

    if (!doc || doc.kind !== 'Ingress') {
      return null;
    }

    return {
      name: doc.metadata?.name,
      annotations: doc.metadata?.annotations || {},
    };
  } catch (err) {
    console.error(`Error reading ${filePath}: ${err.message}`);
    return null;
  }
}

/**
 * Find all ingress YAML files in a directory
 */
function findIngressFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.ingress.yaml'))
    .map((file) => path.join(dir, file));
}

/**
 * Main validation logic
 */
function validateIngressAnnotations() {
  console.log('🔍 Validating ingress annotations for conflicts...\n');

  let hasErrors = false;

  // Load base ingresses
  const baseFiles = findIngressFiles(INGRESS_BASE_DIR);
  const baseIngresses = new Map();

  baseFiles.forEach((file) => {
    const ingress = getAnnotations(file);
    if (ingress && ingress.name) {
      baseIngresses.set(ingress.name, {
        file: path.relative(process.cwd(), file),
        annotations: ingress.annotations,
      });
    }
  });

  // Validate patches against base
  INGRESS_PATCH_DIRS.forEach((patchDir) => {
    const patchFiles = findIngressFiles(patchDir);

    patchFiles.forEach((patchFile) => {
      const patch = getAnnotations(patchFile);
      if (!patch || !patch.name) return;

      const base = baseIngresses.get(patch.name);
      if (!base) {
        // Patch for non-existent base (might be intentional)
        return;
      }

      // Check for annotation conflicts
      const baseKeys = Object.keys(base.annotations);
      const patchKeys = Object.keys(patch.annotations);
      const conflicts = baseKeys.filter((key) => patchKeys.includes(key));

      if (conflicts.length > 0) {
        hasErrors = true;
        const relPath = path.relative(process.cwd(), patchFile);
        console.error(`❌ Annotation conflict detected:`);
        console.error(`   Base:  ${base.file}`);
        console.error(`   Patch: ${relPath}`);
        console.error(`   Conflicting annotations: ${conflicts.join(', ')}`);
        console.error('');

        conflicts.forEach((key) => {
          console.error(`   "${key}":`);
          console.error(`     Base:  "${base.annotations[key]}"`);
          console.error(`     Patch: "${patch.annotations[key]}"`);
        });
        console.error('\n   ⚠️  Patch will silently override base value!\n');
      }
    });
  });

  // Warn if base has annotations (should be annotation-free per new pattern)
  baseIngresses.forEach((base, name) => {
    const annotationCount = Object.keys(base.annotations).length;
    if (annotationCount > 0) {
      console.log(`✓ Base ingress "${name}" has ${annotationCount} common annotation(s)`);
    }
  });

  if (hasErrors) {
    console.error('❌ Ingress annotation validation FAILED\n');
    console.error('Resolution:');
    console.error('  1. Remove conflicting annotation keys from patches');
    console.error('  2. Keep common annotations (WebSocket, session affinity) in base only');
    console.error('  3. Keep env-specific annotations (cert-manager, security) in patches only');
    console.error('  4. Run validation again: node tools/infra/validate-ingress-annotations.js\n');
    process.exit(1);
  }

  console.log('✅ No annotation conflicts detected\n');
  process.exit(0);
}

// Run validation
validateIngressAnnotations();
