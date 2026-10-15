#!/usr/bin/env node

'use strict';

/**
 * Service registry reconciliation (#99).
 *
 * Five hand-kept lists name the same services. Nothing else makes them agree:
 *
 *   deploy-control      infra/deploy-control.yaml, `environments.<env>.services` keys
 *   smart-deploy        infra/smart-deployment-config.yaml, `services` keys
 *   skaffold            skaffold.yaml, `build.artifacts[].image`
 *   nx                  Nx projects with a `container-build` target (image name from
 *                       tools/docker/image-name-map.json, else the project name)
 *   gateway routes      apps/api-gateway/Configuration/Routes/*.json downstream hosts
 *
 * A name in one list and not in another fails here, naming both lists and the direction.
 *
 * The first two use the same names: a deploy-control key is an identity LABEL value (see
 * deploy-scope.js) and a smart-deploy key names the same workload. The image lists (skaffold, nx)
 * use image names. Those differ from workload names (`inference-service` vs `inference`), so the
 * two groups are compared inside the group, never across.
 *
 * Gateway routes name a Kubernetes Service host such as `account-service-svc`. Removing the
 * `-svc` suffix gives the deploy-control key. Whether that key is enabled in an environment is a
 * separate check (#72).
 *
 * Pure functions take plain objects. `loadRegistries` reads the real files.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const workspaceRoot = path.resolve(__dirname, '../..');
const SKIP_DIRS = new Set(['node_modules', '.git', '.claude', '.nx', 'dist', 'bin', 'obj']);

function sorted(values) {
  return [...values].sort();
}

function difference(a, b) {
  return sorted([...a].filter((value) => !b.has(value)));
}

function deployControlKeys(deployControl) {
  const byEnv = {};
  for (const [env, config] of Object.entries(deployControl?.environments || {})) {
    byEnv[env] = new Set(Object.keys(config?.services || {}));
  }
  return byEnv;
}

function findRegistryProblems({
  deployControl,
  smartConfig,
  skaffoldImages,
  nxImages,
  routeHosts,
}) {
  const problems = [];
  const byEnv = deployControlKeys(deployControl);
  const smart = new Set(Object.keys(smartConfig?.services || {}));
  const everyDeployKey = new Set(Object.values(byEnv).flatMap((keys) => [...keys]));

  const missingInSmart = new Map();
  for (const [env, keys] of Object.entries(byEnv)) {
    for (const key of difference(keys, smart)) {
      missingInSmart.set(key, [...(missingInSmart.get(key) || []), env]);
    }
  }
  if (missingInSmart.size > 0) {
    problems.push({
      headline:
        'infra/deploy-control.yaml has a service that infra/smart-deployment-config.yaml lacks',
      items: sorted(missingInSmart.keys()).map(
        (key) => `${key} (deploy-control: ${missingInSmart.get(key).join(', ')})`,
      ),
      detail: [
        'CI selects targeted deploys from the smart-deployment-config keys. A change to only',
        'this service never produces a targeted deploy. Add the service to `services:`.',
      ],
    });
  }

  const onlyInSmart = difference(smart, everyDeployKey);
  if (onlyInSmart.length > 0) {
    problems.push({
      headline:
        'infra/smart-deployment-config.yaml has a service that infra/deploy-control.yaml lacks',
      items: onlyInSmart,
      detail: [
        'A targeted deploy would name a service that no environment grants permission to deploy.',
        'Add a deploy-control entry per environment, or remove the smart-deployment-config entry.',
      ],
    });
  }

  const skaffold = new Set(skaffoldImages);
  const nx = new Set(nxImages);
  const missingInSkaffold = difference(nx, skaffold);
  if (missingInSkaffold.length > 0) {
    problems.push({
      headline: 'Nx container-build projects with no skaffold.yaml artifact',
      items: missingInSkaffold,
      detail: ['Local deploys never build these images. Add an artifact to skaffold.yaml.'],
    });
  }
  const missingInNx = difference(skaffold, nx);
  if (missingInNx.length > 0) {
    problems.push({
      headline: 'skaffold.yaml artifacts with no Nx container-build project',
      items: missingInNx,
      detail: [
        'CI never builds these images. Add a `container-build` target, or map the project name',
        'in tools/docker/image-name-map.json.',
      ],
    });
  }

  const unrouted = [];
  for (const { file, host } of routeHosts || []) {
    const key = host.replace(/-svc$/, '');
    if (!everyDeployKey.has(key)) {
      unrouted.push(`${file} routes to ${host}, so it needs a deploy-control key "${key}"`);
    }
  }
  if (unrouted.length > 0) {
    problems.push({
      headline: 'Gateway route files that name a service infra/deploy-control.yaml lacks',
      items: unrouted,
      detail: ['The gateway would advertise a service that no environment deploys.'],
    });
  }

  return problems;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function findProjectFiles(dir, found = []) {
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) findProjectFiles(path.join(dir, entry.name), found);
    } else if (entry.name === 'project.json') {
      found.push(path.join(dir, entry.name));
    }
  }
  return found;
}

function loadNxImages(root) {
  const mapFile = path.join(root, 'tools', 'docker', 'image-name-map.json');
  const imageMap = fs.existsSync(mapFile) ? readJson(mapFile) : {};
  const images = [];
  for (const top of ['apps', 'libs', 'infra']) {
    for (const file of findProjectFiles(path.join(root, top))) {
      const project = readJson(file);
      if (!project.targets || !project.targets['container-build']) continue;
      images.push(imageMap[project.name]?.imageName || project.name);
    }
  }
  return images;
}

function loadSkaffoldImages(root) {
  const docs = yaml.loadAll(fs.readFileSync(path.join(root, 'skaffold.yaml'), 'utf8'));
  return docs.flatMap((doc) => (doc?.build?.artifacts || []).map((artifact) => artifact.image));
}

function loadRouteHosts(root) {
  const dir = path.join(root, 'apps', 'api-gateway', 'Configuration', 'Routes');
  if (!fs.existsSync(dir)) return [];
  const hosts = [];
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.json'))) {
    const config = readJson(path.join(dir, file));
    const seen = new Set();
    for (const route of config.Routes || []) {
      for (const target of route.DownstreamHostAndPorts || []) {
        if (target.Host && !seen.has(target.Host)) {
          seen.add(target.Host);
          hosts.push({ file, host: target.Host });
        }
      }
    }
  }
  return hosts;
}

function checkServiceRegistries(root = workspaceRoot) {
  return findRegistryProblems({
    deployControl: yaml.load(fs.readFileSync(path.join(root, 'infra/deploy-control.yaml'), 'utf8')),
    smartConfig: yaml.load(
      fs.readFileSync(path.join(root, 'infra/smart-deployment-config.yaml'), 'utf8'),
    ),
    skaffoldImages: loadSkaffoldImages(root),
    nxImages: loadNxImages(root),
    routeHosts: loadRouteHosts(root),
  });
}

function main() {
  const problems = checkServiceRegistries();
  if (problems.length === 0) {
    console.log('service registries agree');
    return;
  }
  for (const problem of problems) {
    console.error(`  ${problem.headline}:`);
    for (const item of problem.items) console.error(`    - ${item}`);
    for (const line of problem.detail) console.error(`    ${line}`);
  }
  process.exit(1);
}

if (require.main === module) main();

module.exports = { findRegistryProblems, checkServiceRegistries };
