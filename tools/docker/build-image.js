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

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// ANSI color codes
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  red: "\x1b[31m",
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
      encoding: "utf-8",
      stdio: silent ? "pipe" : "inherit",
      shell: true,
    });
    return { success: true, output: output || "" };
  } catch (error) {
    return {
      success: false,
      output: error.stdout || error.stderr || error.message,
      error,
    };
  }
}

function getGitInfo() {
  const remote = run("git config --get remote.origin.url", { silent: true });
  if (!remote.success) {
    logWarning("Could not detect git remote. Using defaults.");
    return { owner: "unknown", repo: "unknown" };
  }

  // Parse GitHub URL (supports both HTTPS and SSH)
  const match = remote.output.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/);
  if (match) {
    return { owner: match[1], repo: match[2].trim() };
  }

  return { owner: "unknown", repo: "unknown" };
}

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0].startsWith("--")) {
    logError("Missing project name");
    console.log("\nUsage: node tools/docker/build-image.js <project-name> [options]");
    process.exit(1);
  }

  const projectName = args[0];
  const options = {
    tag: "latest",
    registry: "ghcr.io",
    owner: null,
    repo: null,
    push: false,
    platform: "linux/amd64",
    cache: true,
    copyCerts: false,
    buildArgs: [],
  };

  args.slice(1).forEach((arg) => {
    if (arg.startsWith("--tag=")) {
      const value = arg.split("=")[1];
      if (value) options.tag = value;
    } else if (arg.startsWith("--registry=")) {
      options.registry = arg.split("=")[1];
    } else if (arg.startsWith("--owner=")) {
      options.owner = arg.split("=")[1];
    } else if (arg.startsWith("--repo=")) {
      options.repo = arg.split("=")[1];
    } else if (arg === "--push") {
      options.push = true;
    } else if (arg.startsWith("--platform=")) {
      options.platform = arg.split("=")[1];
    } else if (arg === "--no-cache") {
      options.cache = false;
    } else if (arg === "--copy-certs") {
      options.copyCerts = true;
    } else if (arg.startsWith("--build-arg=")) {
      options.buildArgs.push(arg.split("=")[1]);
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

function findDockerfile(projectName) {
  const workspaceRoot = path.resolve(__dirname, "../..");
  const possiblePaths = [
    path.join(workspaceRoot, "apps", projectName, "Dockerfile"),
    path.join(workspaceRoot, "apps/services", projectName, "Dockerfile"),
    path.join(workspaceRoot, "libs", projectName, "Dockerfile"),
  ];

  for (const dockerfilePath of possiblePaths) {
    if (fs.existsSync(dockerfilePath)) {
      return dockerfilePath;
    }
  }

  return null;
}

function buildImage(projectName, options) {
  const workspaceRoot = path.resolve(__dirname, "../..");
  const dockerfilePath = findDockerfile(projectName);

  if (!dockerfilePath) {
    logError(`Dockerfile not found for project: ${projectName}`);
    logInfo("Searched paths:");
    logInfo(`  - apps/${projectName}/Dockerfile`);
    logInfo(`  - apps/services/${projectName}/Dockerfile`);
    logInfo(`  - libs/${projectName}/Dockerfile`);
    process.exit(1);
  }

  logSuccess(`Found Dockerfile: ${path.relative(workspaceRoot, dockerfilePath)}`);

  // Construct image name
  const imageName = `${options.registry}/${options.owner}/${options.repo}/${projectName}:${options.tag}`;
  logInfo(`Building image: ${imageName}`);

  // Build Docker command
  const buildArgs = ["build", "-f", dockerfilePath, "-t", imageName, "--platform", options.platform];

  // Add build configuration
  buildArgs.push("--build-arg", "BUILD_CONFIGURATION=Release");

  // Add cert handling
  if (options.copyCerts) {
    logInfo("Enterprise certificates will be included (local dev mode)");
    buildArgs.push("--build-arg", "COPY_CERTS=true");
  } else {
    logInfo("Skipping enterprise certificates (CI/CD mode)");
    buildArgs.push("--build-arg", "COPY_CERTS=false");
  }

  // Add custom build args
  options.buildArgs.forEach((arg) => {
    buildArgs.push("--build-arg", arg);
  });

  // Add cache options
  if (!options.cache) {
    buildArgs.push("--no-cache");
  }

  // Add labels
  buildArgs.push("--label", `org.opencontainers.image.source=https://github.com/${options.owner}/${options.repo}`);
  buildArgs.push("--label", `org.opencontainers.image.description=${projectName} service`);
  buildArgs.push("--label", `org.opencontainers.image.licenses=MIT`);

  // Context is workspace root (needed for monorepo COPY commands)
  buildArgs.push(workspaceRoot);

  // Execute build
  logInfo(`Executing: docker ${buildArgs.join(" ")}`);
  const buildResult = run(`docker ${buildArgs.join(" ")}`);

  if (!buildResult.success) {
    logError("Build failed");
    process.exit(1);
  }

  logSuccess(`Build completed: ${imageName}`);

  // Get image size
  const sizeResult = run(`docker images ${imageName} --format "{{.Size}}"`, { silent: true });
  if (sizeResult.success) {
    logInfo(`Image size: ${sizeResult.output.trim()}`);
  }

  // Push if requested
  if (options.push) {
    logInfo(`Pushing image to registry...`);
    const pushResult = run(`docker push ${imageName}`);

    if (!pushResult.success) {
      logError("Push failed");
      process.exit(1);
    }

    logSuccess(`Pushed: ${imageName}`);
  }

  return imageName;
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

  console.log("\n" + "=".repeat(80));
  logSuccess("Image build completed successfully!");
  console.log("=".repeat(80));
  console.log(`\n📦 Image: ${imageName}\n`);
}

module.exports = { buildImage, parseArgs, findDockerfile };
