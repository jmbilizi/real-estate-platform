#!/usr/bin/env node

/**
 * NX Repair Script
 *
 * This script repairs the NX setup by:
 * 1. Creating or updating necessary NX configuration files
 * 2. Ensuring NX is properly installed
 * 3. Setting up minimal configuration for NX to work
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Write file preserving original BOM and line endings
 * @param {string} filePath - Path to file
 * @param {string} content - Content to write
 */
function writeFilePreservingEncoding(filePath, content) {
  // Check if file exists to detect original encoding
  let hasBOM = false;
  let lineEnding = '\n';

  if (fs.existsSync(filePath)) {
    const originalBuffer = fs.readFileSync(filePath);
    hasBOM =
      originalBuffer.length >= 3 &&
      originalBuffer[0] === 0xef &&
      originalBuffer[1] === 0xbb &&
      originalBuffer[2] === 0xbf;

    const originalContent = originalBuffer.toString('utf8');
    lineEnding = originalContent.includes('\r\n') ? '\r\n' : '\n';
  } else {
    // For new files, detect from content being written
    lineEnding = content.includes('\r\n') ? '\r\n' : '\n';
  }

  // Normalize line endings
  if (lineEnding === '\r\n') {
    content = content.replace(/\r?\n/g, '\r\n');
  } else {
    content = content.replace(/\r\n/g, '\n');
  }

  // Write with appropriate BOM
  const outputBuffer = hasBOM
    ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(content, 'utf8')])
    : Buffer.from(content, 'utf8');

  fs.writeFileSync(filePath, outputBuffer);
}

console.log('🔧 Starting NX repair process...');

// Root path
const rootDir = process.cwd();

// Ensure nx.json exists with proper structure
const nxJsonPath = path.join(rootDir, 'nx.json');
let nxJsonExists = fs.existsSync(nxJsonPath);
let nxJson = { plugins: [] };

if (nxJsonExists) {
  try {
    nxJson = JSON.parse(fs.readFileSync(nxJsonPath, 'utf8'));
    console.log('✅ Found existing nx.json');
  } catch (error) {
    console.log('⚠️ Error reading nx.json, creating a new one');
    nxJsonExists = false;
  }
}

// Track whether we need to write changes
let nxJsonDirty = !nxJsonExists;

// Ensure minimum required fields
if (!nxJson.plugins) {
  nxJson.plugins = [];
  nxJsonDirty = true;
}

if (!nxJson.installation) {
  nxJson.installation = { version: '22.0.1' };
  nxJsonDirty = true;
}

if (!nxJson.projects) {
  nxJson.projects = {};
  nxJsonDirty = true;
}

// Check if .NET SDK is available (silently)
let isDotNetAvailable = false;
try {
  const { execSync } = require('child_process');
  execSync('dotnet --version', { stdio: 'pipe' });
  isDotNetAvailable = true;
} catch {
  isDotNetAvailable = false;
}

if (isDotNetAvailable) {
  console.log('✅ .NET SDK detected - @nx/dotnet plugin enabled');
} else {
  console.log(
    '⚠️ .NET SDK not found - @nx/dotnet plugin disabled (run pnpm run dotnet:env to enable)',
  );
  // Remove @nx/dotnet from plugins if present to prevent project graph failures
  const before = nxJson.plugins.length;
  nxJson.plugins = nxJson.plugins.filter((p) => {
    const name = typeof p === 'string' ? p : p.plugin;
    return name !== '@nx/dotnet';
  });
  if (nxJson.plugins.length !== before) nxJsonDirty = true;
}

// Make sure we have all the plugins listed properly
const requiredPlugins = [
  ...(isDotNetAvailable
    ? [
        {
          plugin: '@nx/dotnet',
          options: {
            lintTargetName: 'lint',
            formatTargetName: 'format',
            testTargetName: 'test',
            buildTargetName: 'build',
            serveTargetName: 'serve',
          },
        },
      ]
    : []),
  {
    plugin: '@nx/js/typescript',
    options: {
      typecheck: { targetName: 'type-check' },
      build: {
        targetName: 'build',
        configName: 'tsconfig.lib.json',
        buildDepsName: 'build-deps',
        watchDepsName: 'watch-deps',
      },
    },
  },
  {
    plugin: '@nx/eslint/plugin',
    options: { targetName: 'lint' },
  },
  {
    plugin: '@nxlv/python',
    options: {
      lintTargetName: 'lint',
      formatTargetName: 'format',
      testTargetName: 'test',
      buildTargetName: 'build',
      serveTargetName: 'serve',
      typecheckTargetName: 'type-check',
    },
  },
];

// Check if each required plugin exists, add if missing
for (const requiredPlugin of requiredPlugins) {
  if (typeof requiredPlugin === 'string') {
    // For string plugins, check if they exist
    const exists = nxJson.plugins.some(
      (p) =>
        (typeof p === 'string' && p === requiredPlugin) ||
        (typeof p === 'object' && p.plugin === requiredPlugin),
    );

    if (!exists) {
      console.log(`➕ Adding missing plugin: ${requiredPlugin}`);
      nxJson.plugins.push(requiredPlugin);
      nxJsonDirty = true;
    }
  } else {
    // For object plugins, check by plugin name
    const pluginName = requiredPlugin.plugin;
    const exists = nxJson.plugins.some((p) => typeof p === 'object' && p.plugin === pluginName);

    if (!exists) {
      console.log(`➕ Adding missing plugin: ${pluginName}`);
      nxJson.plugins.push(requiredPlugin);
      nxJsonDirty = true;
    }
  }
}

// Only write nx.json when something was actually mutated — avoids false diffs on every commit
if (nxJsonDirty) {
  writeFilePreservingEncoding(nxJsonPath, JSON.stringify(nxJson, null, 2) + '\n');
  console.log('✅ Updated nx.json with proper configuration');
} else {
  console.log('✅ nx.json already up to date');
}

// Ensure .nx directory exists
const nxDir = path.join(rootDir, '.nx');
if (!fs.existsSync(nxDir)) {
  fs.mkdirSync(nxDir, { recursive: true });
  console.log('✅ Created .nx directory');
}

// Pre-clean workspace-data so `nx reset` never hits ENOTEMPTY / EPERM on Windows.
// The Nx daemon can leave this directory in a locked or non-empty state that
// prevents `nx reset` from deleting it. Removing it here (before nx reset runs)
// is safe — nx reset recreates it from scratch anyway.
const workspaceDataDir = path.join(nxDir, 'workspace-data');
if (fs.existsSync(workspaceDataDir)) {
  try {
    fs.rmSync(workspaceDataDir, { recursive: true, force: true });
  } catch {
    // Ignore — if still locked, nx reset will attempt its own cleanup
  }
}

// Create a minimal project-graph.json to ensure nx can run without projects
const projectGraphPath = path.join(nxDir, 'project-graph.json');
const minimalProjectGraph = {
  nodes: {},
  dependencies: {},
  version: '6.0',
};

// Always write the project-graph.json to ensure it's valid
writeFilePreservingEncoding(projectGraphPath, JSON.stringify(minimalProjectGraph, null, 2) + '\n');
console.log('✅ Created/Updated minimal project-graph.json for Nx to work without projects');

// Ensure cache directory exists
const cachePath = path.join(nxDir, 'cache');
if (!fs.existsSync(cachePath)) {
  fs.mkdirSync(cachePath, { recursive: true });
  console.log('✅ Created .nx/cache directory');
}

// Ensure nx-cloud.env file exists with basic content
const nxCloudEnvPath = path.join(nxDir, 'nx-cloud.env');
if (!fs.existsSync(nxCloudEnvPath)) {
  writeFilePreservingEncoding(nxCloudEnvPath, '# Nx Cloud Environment Variables\n');
  console.log('✅ Created nx-cloud.env file');
}

// Create workspace.json if it doesn't exist (helps with nx run-many)
const workspaceJsonPath = path.join(rootDir, 'workspace.json');
if (!fs.existsSync(workspaceJsonPath)) {
  const workspaceJson = {
    version: 2,
    projects: {},
  };
  writeFilePreservingEncoding(workspaceJsonPath, JSON.stringify(workspaceJson, null, 2) + '\n');
  console.log('✅ Created workspace.json file');
}

// Update nx.bat file if it doesn't exist or is incorrect
const nxBatPath = path.join(rootDir, 'nx.bat');
const correctNxBatContent = `@echo off
rem NX wrapper for Windows
rem This script executes NX commands directly using the local NX installation

node_modules\\.bin\\nx %*
`;

let updateNxBat = true;
if (fs.existsSync(nxBatPath)) {
  const currentContent = fs.readFileSync(nxBatPath, 'utf8');
  if (currentContent.includes('node_modules\\.bin\\nx %*')) {
    updateNxBat = false;
  }
}

if (updateNxBat) {
  writeFilePreservingEncoding(nxBatPath, correctNxBatContent);
  console.log('✅ Updated nx.bat file');
}

// Run pnpm exec nx --version to verify installation
try {
  console.log('⚙️ Verifying NX installation...');
  const version = execSync('pnpm exec nx --version', { stdio: 'pipe' }).toString().trim();
  console.log(`✅ NX is installed: ${version}`);
} catch (error) {
  console.log('⚠️ Error verifying NX. Trying to reinstall NX...');
  try {
    execSync('pnpm add -D nx@latest', { stdio: 'inherit' });
    console.log('✅ Reinstalled NX');
  } catch (installError) {
    console.error('❌ Failed to reinstall NX', installError.message);
    process.exit(1);
  }
}

console.log('🎉 NX repair completed successfully!');
console.log('You can now try running NX commands like:');
console.log('  pnpm exec nx graph');
console.log('  pnpm exec nx run-many --target=lint --projects=tag:runtime:python');
console.log('Or use the pnpm scripts defined in package.json.');
