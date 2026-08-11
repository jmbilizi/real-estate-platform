#!/usr/bin/env node

/**
 * Docker Image Builder for Nx Monorepo
 *
 * Usage:
 *   node tools/docker/build-image.js <project-name> [options]
 *
 * Options:
 *   --tag=<tag>              Image tag (default: latest)
 *   --registry=<registry>    Registry URL (default: ghcr.io)
 *   --owner=<owner>          Registry owner/org (default: from git)
 *   --repo=<repo>            Repository name (default: from git)
 *   --push                   Push after build
 *   --platform=<platform>    Target platform (default: linux/amd64)
 *   --no-cache               Disable Docker cache
 *   --copy-certs             Include enterprise certificates (local dev only)
 *
 * Examples:
 *   node tools/docker/build-image.js api-gateway --tag=dev
 *   node tools/docker/build-image.js api-gateway --tag=latest --push
 *   node tools/docker/build-image.js api-gateway --copy-certs --tag=local
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Resolves a project name to its on-disk root by reading project.json files. Interpolating the name
// into `libs/${projectName}/Dockerfile` breaks for a scoped Nx project name (e.g.
// `@cribstop/property-contracts`), which would mangle into a bogus nested path. Reading the
// manifests also keeps the project name out of any shell — see tools/lib/project-root.js.
const { resolveProjectRoot } = require('../lib/project-root');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✅ ${message}`, colors.green);
}

function logInfo(message) {
  log(`ℹ️  ${message}`, colors.blue);
}

function logWarning(message) {
  log(`⚠️  ${message}`, colors.yellow);
}

function logError(message) {
  log(`❌ ${message}`, colors.red);
}

function run(command, options = {}) {
  const { silent = false, cwd = process.cwd() } = options;
  try {
    const output = execSync(command, {
      cwd,
      encoding: 'utf-8',
      stdio: silent ? 'pipe' : 'inherit',
      shell: true,
    });
    return { success: true, output: output || '' };
  } catch (error) {
    return {
      success: false,
      output: error.stdout || error.stderr || error.message,
      error,
    };
  }
}

function getGitInfo() {
  const remote = run('git config --get remote.origin.url', { silent: true });
  if (!remote.success) {
    logWarning('Could not detect git remote. Using defaults.');
    return { owner: 'unknown', repo: 'unknown' };
  }

  // Parse GitHub URL (supports both HTTPS and SSH)
  const match = remote.output.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/);
  if (match) {
    return { owner: match[1], repo: match[2].trim() };
  }

  return { owner: 'unknown', repo: 'unknown' };
}

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0].startsWith('--')) {
    logError('Missing project name');
    console.log('\nUsage: node tools/docker/build-image.js <project-name> [options]');
    process.exit(1);
  }

  const projectName = args[0];
  const options = {
    tag: 'latest',
    registry: 'ghcr.io',
    owner: null,
    repo: null,
    push: false,
    platform: 'linux/amd64',
    cache: true,
    copyCerts: false,
    buildArgs: [],
  };

  args.slice(1).forEach((arg) => {
    if (arg.startsWith('--tag=')) {
      const value = arg.split('=')[1];
      if (value) options.tag = value;
    } else if (arg.startsWith('--registry=')) {
      options.registry = arg.split('=')[1];
    } else if (arg.startsWith('--owner=')) {
      options.owner = arg.split('=')[1];
    } else if (arg.startsWith('--repo=')) {
      options.repo = arg.split('=')[1];
    } else if (arg === '--push') {
      options.push = true;
    } else if (arg.startsWith('--platform=')) {
      options.platform = arg.split('=')[1];
    } else if (arg === '--no-cache') {
      options.cache = false;
    } else if (arg === '--copy-certs') {
      options.copyCerts = true;
    } else if (arg.startsWith('--build-arg=')) {
      options.buildArgs.push(arg.split('=')[1]);
    }
  });

  // Auto-detect owner/repo from git if not provided
  if (!options.owner || !options.repo) {
    const gitInfo = getGitInfo();
    options.owner = options.owner || gitInfo.owner;
    options.repo = options.repo || gitInfo.repo;
  }

  return { projectName, options };
}

/**
 * Load image-name overrides from the centralized map.
 * Returns { projectName → { imageName, dockerfilePath } }
 */
function loadImageNameMap() {
  const mapPath = path.join(path.resolve(__dirname, '../..'), 'tools/docker/image-name-map.json');
  if (!fs.existsSync(mapPath)) return {};
  const raw = JSON.parse(fs.readFileSync(mapPath, 'utf-8'));
  // Filter out $comment key
  const map = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key !== '$comment' && typeof value === 'object') {
      map[key] = value;
    }
  }
  return map;
}

function findDockerfile(projectName) {
  const workspaceRoot = path.resolve(__dirname, '../..');

  // Check centralized overrides first (handles renamed projects)
  const nameMap = loadImageNameMap();
  if (nameMap[projectName] && nameMap[projectName].dockerfilePath) {
    const overridePath = path.join(
      workspaceRoot,
      nameMap[projectName].dockerfilePath,
      'Dockerfile',
    );
    if (fs.existsSync(overridePath)) {
      return overridePath;
    }
  }

  // Resolve via the project's own root in the Nx project graph — safe for scoped project names.
  const projectRoot = resolveProjectRoot(projectName);
  if (projectRoot) {
    const rootPath = path.join(workspaceRoot, projectRoot, 'Dockerfile');
    if (fs.existsSync(rootPath)) {
      return rootPath;
    }
  }

  // Fallback for the rare case `nx show project` cannot run at all (e.g. no project graph yet).
  const possiblePaths = [
    path.join(workspaceRoot, 'apps', projectName, 'Dockerfile'),
    path.join(workspaceRoot, 'apps/services', projectName, 'Dockerfile'),
    path.join(workspaceRoot, 'libs', projectName, 'Dockerfile'),
  ];

  for (const dockerfilePath of possiblePaths) {
    if (fs.existsSync(dockerfilePath)) {
      return dockerfilePath;
    }
  }

  return null;
}

/**
 * Resolve the Docker image name for a project.
 * Uses image-name-map.json when the Nx project name differs from the desired image name.
 */
function resolveImageName(projectName) {
  const nameMap = loadImageNameMap();
  if (nameMap[projectName] && nameMap[projectName].imageName) {
    return nameMap[projectName].imageName;
  }
  return projectName;
}

function buildImage(projectName, options) {
  const workspaceRoot = path.resolve(__dirname, '../..');
  const imageName = resolveImageName(projectName);
  const dockerfilePath = findDockerfile(projectName);

  if (!dockerfilePath) {
    logError(`Dockerfile not found for project: ${projectName}`);
    logInfo('Searched paths:');
    logInfo(`  - apps/${projectName}/Dockerfile`);
    logInfo(`  - apps/services/${projectName}/Dockerfile`);
    logInfo(`  - libs/${projectName}/Dockerfile`);
    const nameMap = loadImageNameMap();
    if (nameMap[projectName]) {
      logInfo(`  - ${nameMap[projectName].dockerfilePath}/Dockerfile (from image-name-map.json)`);
    }
    process.exit(1);
  }

  logSuccess(`Found Dockerfile: ${path.relative(workspaceRoot, dockerfilePath)}`);

  if (imageName !== projectName) {
    logInfo(`Image name override: ${projectName} → ${imageName} (from image-name-map.json)`);
  }

  // Construct full image reference (use resolved imageName, not Nx projectName)
  const fullImageRef = `${options.registry}/${options.owner}/${options.repo}/${imageName}:${options.tag}`;
  logInfo(`Building image: ${fullImageRef}`);

  // Build Docker command
  const buildArgs = [
    'build',
    '-f',
    dockerfilePath,
    '-t',
    fullImageRef,
    '--platform',
    options.platform,
  ];

  // Add build configuration
  buildArgs.push('--build-arg', 'BUILD_CONFIGURATION=Release');

  // Add cert handling
  if (options.copyCerts) {
    logInfo('Enterprise certificates will be included (local dev mode)');
    buildArgs.push('--build-arg', 'COPY_CERTS=true');
  } else {
    logInfo('Skipping enterprise certificates (CI/CD mode)');
    buildArgs.push('--build-arg', 'COPY_CERTS=false');
  }

  // Add custom build args
  options.buildArgs.forEach((arg) => {
    buildArgs.push('--build-arg', arg);
  });

  // Add cache options
  if (!options.cache) {
    buildArgs.push('--no-cache');
  }

  // Add labels
  buildArgs.push(
    '--label',
    `org.opencontainers.image.source=https://github.com/${options.owner}/${options.repo}`,
  );
  buildArgs.push('--label', `org.opencontainers.image.description=${projectName} service`);
  buildArgs.push('--label', `org.opencontainers.image.licenses=MIT`);

  // Context is workspace root (needed for monorepo COPY commands)
  buildArgs.push(workspaceRoot);

  // Execute build
  logInfo(`Executing: docker ${buildArgs.join(' ')}`);
  const buildResult = run(`docker ${buildArgs.join(' ')}`);

  if (!buildResult.success) {
    logError('Build failed');
    process.exit(1);
  }

  logSuccess(`Build completed: ${fullImageRef}`);

  // Get image size
  const sizeResult = run(`docker images ${fullImageRef} --format "{{.Size}}"`, { silent: true });
  if (sizeResult.success) {
    logInfo(`Image size: ${sizeResult.output.trim()}`);
  }

  // Push if requested
  if (options.push) {
    logInfo(`Pushing image to registry...`);
    const pushResult = run(`docker push ${fullImageRef}`);

    if (!pushResult.success) {
      logError('Push failed');
      process.exit(1);
    }

    logSuccess(`Pushed: ${fullImageRef}`);
  }

  return fullImageRef;
}

// Main execution
if (require.main === module) {
  const { projectName, options } = parseArgs();

  logInfo(`Building Docker image for project: ${projectName}`);
  logInfo(`Registry: ${options.registry}`);
  logInfo(`Owner: ${options.owner}`);
  logInfo(`Repository: ${options.repo}`);
  logInfo(`Tag: ${options.tag}`);
  logInfo(`Platform: ${options.platform}`);

  const imageName = buildImage(projectName, options);

  console.log('\n' + '='.repeat(80));
  logSuccess('Image build completed successfully!');
  console.log('='.repeat(80));
  console.log(`\n📦 Image: ${imageName}\n`);
}

module.exports = { buildImage, parseArgs, findDockerfile, resolveImageName, resolveProjectRoot };
