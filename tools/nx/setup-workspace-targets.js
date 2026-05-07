#!/usr/bin/env node

/**
 * Setup Workspace Targets (Unified)
 *
 * Single-pass scan across every Nx project.  Ensures each project.json has
 * the correct targets regardless of language:
 *
 *   .NET    → build, serve, test, lint, format, format-check, type-check, container-build, 'dotnet' tag
 *   Node    → lint, type-check, format, format-check, test, container-build
 *   Python  → lock, sync, add, update, remove, build, lint, format, test, install,
 *             serve, type-check, format-check  (auto-created from UV workspace members)
 *
 * Python pre-scan: The @nxlv/python plugin does NOT auto-discover projects.
 * Before scanning Nx projects, we read the root pyproject.toml [tool.uv.workspace]
 * members and create project.json for any that are missing.
 *
 * Also synchronises the .NET solution file (.sln) after processing.
 *
 * Called by `pnpm run nx:reset`.
 *
 * The individual language scripts still work standalone:
 *   node tools/dotnet/scripts/setup-dotnet-projects.js
 *   node tools/nx/setup-standard-targets.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ---------------------------------------------------------------------------
// Imports from existing maintainer scripts (each still runs standalone)
// ---------------------------------------------------------------------------

const {
  writeFilePreservingEncoding,
  determineProjectType: determineDotNetProjectType,
  addProjectsToSolution,
  cleanupSolutionFile,
} = require('../dotnet/scripts/setup-dotnet-projects');

const {
  toPosix,
  isNodeProject,
  isEligibleForAutoProjectJson,
  createMinimalNodeProjectJson,
  ensureNodeTargets,
  ensureContainerBuildTarget,
} = require('./setup-standard-targets');

// ---------------------------------------------------------------------------
// Console helpers
// ---------------------------------------------------------------------------

const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  reset: '\x1b[0m',
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

// ---------------------------------------------------------------------------
// Nx helpers
// ---------------------------------------------------------------------------

// Disable the Nx daemon for this setup script.  When the Python pre-scan
// creates project.json files mid-run the daemon's project graph becomes stale
// and crashes.  Running daemon-free is perfectly fine for a one-off setup task.
const nxEnv = { ...process.env, NX_DAEMON: 'false' };

function runJsonSilent(command) {
  const output = execSync(command, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: nxEnv,
  });
  return JSON.parse(output);
}

function tryGetProjectConfig(projectName) {
  try {
    return runJsonSilent(`pnpm exec nx show project ${projectName} --json`);
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

function isDotNetProject(projectRootAbs) {
  try {
    return fs.readdirSync(projectRootAbs).some((f) => f.endsWith('.csproj'));
  } catch (e) {
    return false;
  }
}

function isPythonProject(projectRootAbs) {
  try {
    return fs.existsSync(path.join(projectRootAbs, 'pyproject.toml'));
  } catch (e) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Python target helpers
// ---------------------------------------------------------------------------

/**
 * Ensure Python projects have the supplementary targets that the @nxlv/python
 * plugin doesn't generate (serve, type-check, format-check).
 * The plugin already handles: build, lint, format, test, install, lock, sync, add, update, remove.
 */
function ensurePythonTargets(targets, projectRootRel, projectType) {
  const added = [];

  // serve – application projects only
  if (projectType === 'application' && !targets.serve) {
    targets.serve = {
      executor: 'nx:run-commands',
      options: {
        command: `uv run uvicorn ${path.basename(projectRootRel).replace(/-/g, '_')}.main:app --reload --host 0.0.0.0 --port 8000`,
        cwd: projectRootRel,
      },
    };
    added.push('serve');
  }

  // type-check – all projects
  if (!targets['type-check']) {
    targets['type-check'] = {
      executor: 'nx:run-commands',
      options: { command: 'uv run mypy .', cwd: projectRootRel },
    };
    added.push('type-check');
  }

  // format-check – all projects
  if (!targets['format-check']) {
    targets['format-check'] = {
      executor: 'nx:run-commands',
      options: { command: 'uv run ruff format --check .', cwd: projectRootRel },
    };
    added.push('format-check');
  }

  return added;
}

// ---------------------------------------------------------------------------
// Python project discovery (pre-scan for missing project.json)
// ---------------------------------------------------------------------------

/**
 * Parse the root pyproject.toml to extract UV workspace members.
 * Returns an array of relative POSIX paths like ["apps/services/hello-world"].
 */
function getUvWorkspaceMembers(workspaceRoot) {
  const pyprojectPath = path.join(workspaceRoot, 'pyproject.toml');
  if (!fs.existsSync(pyprojectPath)) return [];

  const content = fs.readFileSync(pyprojectPath, 'utf8');
  // Match: members = ["path1", "path2", ...]
  const match = content.match(/members\s*=\s*\[([^\]]*)\]/);
  if (!match) return [];

  const members = [];
  const strRe = /"([^"]+)"|'([^']+)'/g;
  let m;
  while ((m = strRe.exec(match[1])) !== null) {
    members.push(m[1] || m[2]);
  }
  return members;
}

/**
 * Read the project name from a Python pyproject.toml.
 */
function getPythonProjectName(projectRootAbs) {
  const pyprojectPath = path.join(projectRootAbs, 'pyproject.toml');
  if (!fs.existsSync(pyprojectPath)) return null;

  const content = fs.readFileSync(pyprojectPath, 'utf8');
  const match = content.match(/^\s*name\s*=\s*"([^"]+)"/m);
  return match ? match[1] : null;
}

/**
 * Create a full Python project.json with @nxlv/python executor targets.
 * The @nxlv/python plugin does NOT auto-discover projects — project.json must exist.
 */
function createMinimalPythonProjectJson(
  projectName,
  projectRootRel,
  projectRootAbs,
  workspaceRoot,
  projectType,
) {
  const schemaRel = toPosix(
    path.relative(
      projectRootAbs,
      path.join(workspaceRoot, 'node_modules/nx/schemas/project-schema.json'),
    ),
  );
  const packageName = projectName.replace(/-/g, '_');

  return {
    name: projectName,
    $schema: schemaRel,
    projectType: projectType,
    sourceRoot: toPosix(path.join(projectRootRel, packageName)),
    targets: {
      lock: {
        executor: '@nxlv/python:lock',
        options: { update: false },
      },
      sync: {
        executor: '@nxlv/python:sync',
        options: {},
      },
      add: {
        executor: '@nxlv/python:add',
        options: {},
      },
      update: {
        executor: '@nxlv/python:update',
        options: {},
      },
      remove: {
        executor: '@nxlv/python:remove',
        options: {},
      },
      build: {
        executor: '@nxlv/python:build',
        outputs: ['{projectRoot}/dist'],
        options: {
          outputPath: '{projectRoot}/dist',
          publish: false,
          lockedVersions: true,
          bundleLocalDependencies: true,
        },
        cache: true,
      },
      lint: {
        executor: '@nxlv/python:ruff-check',
        outputs: [],
        options: {
          lintFilePatterns: [packageName, 'tests'],
        },
        cache: true,
      },
      format: {
        executor: '@nxlv/python:ruff-format',
        outputs: [],
        options: {
          filePatterns: [packageName, 'tests'],
        },
        cache: true,
      },
      test: {
        executor: '@nxlv/python:run-commands',
        outputs: [
          '{workspaceRoot}/reports/{projectRoot}/unittests',
          '{workspaceRoot}/coverage/{projectRoot}',
        ],
        options: {
          command: 'uv run pytest tests/',
          cwd: '{projectRoot}',
        },
        cache: true,
      },
      install: {
        executor: '@nxlv/python:install',
        options: {
          silent: false,
          args: '',
          verbose: false,
          debug: false,
        },
      },
    },
    tags: ['runtime:python'],
  };
}

/**
 * Pre-scan: discover Python UV workspace members that lack project.json.
 * Creates project.json with full @nxlv/python targets + supplementary targets.
 * Must run BEFORE `pnpm exec nx show projects` so Nx discovers them.
 */
function discoverMissingPythonProjects(workspaceRoot) {
  const members = getUvWorkspaceMembers(workspaceRoot);
  if (members.length === 0) return 0;

  let created = 0;
  for (const memberRel of members) {
    const memberAbs = path.join(workspaceRoot, memberRel);
    const projectJsonPath = path.join(memberAbs, 'project.json');

    // Skip if project.json already exists
    if (fs.existsSync(projectJsonPath)) continue;

    // Skip if directory or pyproject.toml doesn't exist
    if (!fs.existsSync(path.join(memberAbs, 'pyproject.toml'))) continue;

    const projectName = getPythonProjectName(memberAbs);
    if (!projectName) {
      log(
        `  ⚠ ${memberRel}: Could not read project name from pyproject.toml – skipping`,
        'yellow',
      );
      continue;
    }

    // Infer project type from path: libs/ → library, everything else → application
    const projectType = toPosix(memberRel).startsWith('libs/') ? 'library' : 'application';

    const pj = createMinimalPythonProjectJson(
      projectName,
      toPosix(memberRel),
      memberAbs,
      workspaceRoot,
      projectType,
    );

    // Add supplementary targets (serve, type-check, format-check)
    ensurePythonTargets(pj.targets, toPosix(memberRel), projectType);

    writeFilePreservingEncoding(projectJsonPath, JSON.stringify(pj, null, 2) + '\n');
    log(`  ✓ ${projectName}: Created project.json (Python – ${projectType})`, 'green');
    created++;
  }

  return created;
}

// ---------------------------------------------------------------------------
// .NET companion test detection
// ---------------------------------------------------------------------------

/**
 * Check for a companion test project in a Tests/ subfolder.
 * Convention: {project}/Tests/{name}.Tests.csproj
 * Returns the subfolder name ('Tests') if found, or null.
 */
function findCompanionTestSubdir(projectRootAbs) {
  const testsDir = path.join(projectRootAbs, 'Tests');
  try {
    if (!fs.existsSync(testsDir) || !fs.statSync(testsDir).isDirectory()) return null;
    const csprojFiles = fs.readdirSync(testsDir).filter((f) => f.endsWith('.Tests.csproj'));
    return csprojFiles.length > 0 ? 'Tests' : null;
  } catch {
    return null;
  }
}

/**
 * Determine if a project root is a companion Tests/ subfolder of another project.
 * e.g. "apps/api-gateway/Tests" is a companion of "apps/api-gateway"
 */
function isCompanionTestSubfolder(projectRootRel, allProjectNames) {
  const posixRoot = toPosix(projectRootRel);
  // Check if the root ends with /Tests (case-insensitive for safety)
  if (!/\/Tests$/i.test(posixRoot)) return false;
  // The parent would be everything before /Tests
  const parentRoot = posixRoot.replace(/\/Tests$/i, '');
  // Verify the parent directory has a .csproj (it's a real .NET project, not just a folder)
  const parentAbs = path.join(process.cwd(), parentRoot);
  try {
    return fs.readdirSync(parentAbs).some((f) => f.endsWith('.csproj'));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// .NET target helpers  (mirrors logic in setup-dotnet-projects.js)
// ---------------------------------------------------------------------------

/**
 * Add missing .NET standard targets to an existing targets object.
 * Returns the list of target names that were added.
 */
function ensureDotNetTargets(targets, projectRootRel, projectRootAbs, projectType, isTest) {
  const added = [];

  // build – all projects
  if (!targets.build) {
    targets.build = {
      executor: 'nx:run-commands',
      options: { command: 'dotnet build', cwd: projectRootRel },
    };
    added.push('build');
  }

  // serve – application projects only (not libraries or tests)
  if (projectType === 'application' && !isTest && !targets.serve) {
    targets.serve = {
      executor: 'nx:run-commands',
      options: { command: 'dotnet run', cwd: projectRootRel },
    };
    added.push('serve');
  }

  // test – test projects only
  if (isTest && !targets.test) {
    targets.test = {
      executor: 'nx:run-commands',
      options: { command: 'dotnet test', cwd: projectRootRel },
    };
    added.push('test');
  }

  // test – non-test projects with a companion Tests/ subfolder
  if (!isTest && !targets.test) {
    const companionSubdir = findCompanionTestSubdir(projectRootAbs);
    if (companionSubdir) {
      targets.test = {
        executor: 'nx:run-commands',
        options: {
          command: 'dotnet test',
          cwd: toPosix(path.join(projectRootRel, companionSubdir)),
        },
      };
      added.push('test');
    }
  }

  // lint – all projects
  if (!targets.lint) {
    targets.lint = {
      executor: 'nx:run-commands',
      options: { command: 'dotnet format analyzers --verify-no-changes', cwd: projectRootRel },
    };
    added.push('lint');
  }

  // format – all projects
  if (!targets.format) {
    targets.format = {
      executor: 'nx:run-commands',
      options: { command: 'dotnet format', cwd: projectRootRel },
    };
    added.push('format');
  }

  // format-check – all projects
  if (!targets['format-check']) {
    targets['format-check'] = {
      executor: 'nx:run-commands',
      options: { command: 'dotnet format --verify-no-changes', cwd: projectRootRel },
    };
    added.push('format-check');
  }

  // type-check – all projects (dotnet build IS the type checker)
  if (!targets['type-check']) {
    targets['type-check'] = {
      executor: 'nx:run-commands',
      options: { command: 'dotnet build --nologo --no-restore', cwd: projectRootRel },
    };
    added.push('type-check');
  }

  return added;
}

function ensureDotNetTags(projectJson) {
  projectJson.tags = projectJson.tags || [];
  if (!projectJson.tags.some((t) => t.startsWith('runtime:'))) {
    projectJson.tags.push('runtime:dotnet');
    return true;
  }
  return false;
}

function createMinimalDotNetProjectJson(
  projectName,
  projectRootRel,
  projectRootAbs,
  workspaceRoot,
  projectType,
) {
  const schemaRel = toPosix(
    path.relative(
      projectRootAbs,
      path.join(workspaceRoot, 'node_modules/nx/schemas/project-schema.json'),
    ),
  );

  return {
    name: projectName,
    $schema: schemaRel,
    sourceRoot: projectRootRel,
    projectType: projectType,
    targets: {},
    tags: ['runtime:dotnet'],
  };
}

// ---------------------------------------------------------------------------
// .NET solution sync
// ---------------------------------------------------------------------------

function syncSolution() {
  log('\n🔗 Synchronizing .NET solution file...\n', 'blue');
  const result = addProjectsToSolution();
  cleanupSolutionFile();
  if (result.added > 0 || result.removed > 0) {
    log(`   Added: ${result.added}  Removed: ${result.removed}`, 'blue');
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const workspaceRoot = process.cwd();

  log('\n🔧 Setting up workspace targets...\n', 'blue');

  // --- Pre-scan: create project.json for undiscovered Python projects -----
  // The @nxlv/python plugin does NOT auto-discover projects from pyproject.toml
  // (unlike @nx/dotnet which auto-discovers .csproj files).  We must create
  // project.json BEFORE `pnpm exec nx show projects` so Nx registers them.
  const pythonPreCreated = discoverMissingPythonProjects(workspaceRoot);
  if (pythonPreCreated > 0) {
    log(`   Pre-scan: created ${pythonPreCreated} Python project.json file(s)\n`, 'green');
  }

  // --- Single project scan ------------------------------------------------
  const projectNames = runJsonSilent('pnpm exec nx show projects --json');

  if (projectNames.length === 0) {
    log('No Nx projects found in the workspace.\n', 'yellow');
    // Still sync solution in case .csproj files exist outside Nx
    syncSolution();
    return;
  }

  log(`Scanning ${projectNames.length} Nx project(s)...\n`, 'blue');

  const stats = {
    total: projectNames.length,
    dotnet: 0,
    node: 0,
    python: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    upToDate: 0,
  };

  for (const projectName of projectNames) {
    const effective = tryGetProjectConfig(projectName);
    if (!effective) {
      log(`  ⚠ ${projectName}: Could not read project config – skipping`, 'yellow');
      stats.skipped++;
      continue;
    }

    const projectRootRel = effective.root;
    const projectRootAbs = path.join(workspaceRoot, projectRootRel);
    const projectJsonPath = path.join(projectRootAbs, 'project.json');
    const projectJsonExists = fs.existsSync(projectJsonPath);

    // Detect language -------------------------------------------------------
    const dotnetDetected = isDotNetProject(projectRootAbs);
    const nodeDetected = isNodeProject(effective, projectRootAbs);
    const pythonDetected = isPythonProject(projectRootAbs);

    if (dotnetDetected) stats.dotnet++;

    // Skip companion test subfolders – handled by parent project's test target
    if (isCompanionTestSubfolder(projectRootRel, projectNames)) {
      log(`  ℹ ${projectName}: Companion test project – managed by parent`, 'yellow');
      stats.skipped++;
      continue;
    }
    if (nodeDetected) stats.node++;
    if (pythonDetected) stats.python++;

    // -----------------------------------------------------------------------
    // Create project.json when it doesn't exist yet
    // -----------------------------------------------------------------------
    if (!projectJsonExists) {
      // Only auto-create project.json for projects under apps/ or libs/
      if (!isEligibleForAutoProjectJson(projectRootRel)) {
        stats.skipped++;
        continue;
      }

      if (dotnetDetected) {
        const info = determineDotNetProjectType(projectRootAbs);
        const projectType = typeof info === 'string' ? info : info.type;
        const isTest = typeof info === 'string' ? false : info.isTest;

        const pj = createMinimalDotNetProjectJson(
          projectName,
          projectRootRel,
          projectRootAbs,
          workspaceRoot,
          projectType,
        );
        ensureDotNetTargets(pj.targets, projectRootRel, projectRootAbs, projectType, isTest);
        const hasDockerfile = fs.existsSync(path.join(projectRootAbs, 'Dockerfile'));
        ensureContainerBuildTarget(pj, hasDockerfile);
        writeFilePreservingEncoding(projectJsonPath, JSON.stringify(pj, null, 2) + '\n');
        log(`  ✓ ${projectName}: Created project.json (.NET – ${projectType})`, 'green');
        stats.created++;
        continue;
      }

      if (nodeDetected) {
        const pj = createMinimalNodeProjectJson(
          projectName,
          effective,
          projectRootRel,
          workspaceRoot,
        );
        ensureNodeTargets(pj, projectName, projectRootRel, projectRootAbs, workspaceRoot);
        const hasDockerfile = fs.existsSync(path.join(projectRootAbs, 'Dockerfile'));
        ensureContainerBuildTarget(pj, hasDockerfile);
        writeFilePreservingEncoding(projectJsonPath, JSON.stringify(pj, null, 2) + '\n');
        log(`  ✓ ${projectName}: Created project.json (Node)`, 'green');
        stats.created++;
        continue;
      }

      // Not eligible for auto-creation
      stats.skipped++;
      continue;
    }

    // -----------------------------------------------------------------------
    // Update existing project.json
    // -----------------------------------------------------------------------
    const beforeRaw = fs.readFileSync(projectJsonPath, 'utf8');
    const projectJson = JSON.parse(beforeRaw);

    // .NET targets
    if (dotnetDetected) {
      const info = determineDotNetProjectType(projectRootAbs);
      const projectType = typeof info === 'string' ? info : info.type;
      const isTest = typeof info === 'string' ? false : info.isTest;

      if (projectJson.projectType !== projectType) {
        projectJson.projectType = projectType;
      }
      projectJson.targets = projectJson.targets || {};
      ensureDotNetTargets(projectJson.targets, projectRootRel, projectRootAbs, projectType, isTest);
      ensureDotNetTags(projectJson);
    }

    // Node targets
    if (nodeDetected) {
      ensureNodeTargets(projectJson, projectName, projectRootRel, projectRootAbs, workspaceRoot);
    }

    // Python supplementary targets (plugin handles core targets)
    if (pythonDetected) {
      projectJson.targets = projectJson.targets || {};
      ensurePythonTargets(
        projectJson.targets,
        projectRootRel,
        projectJson.projectType || 'application',
      );
    }

    // Container-build for ALL projects based on Dockerfile presence
    const hasDockerfile = fs.existsSync(path.join(projectRootAbs, 'Dockerfile'));
    ensureContainerBuildTarget(projectJson, hasDockerfile);

    // Persist only when something actually changed
    const afterRaw = JSON.stringify(projectJson, null, 2) + '\n';
    if (afterRaw !== beforeRaw.replace(/\r\n/g, '\n')) {
      writeFilePreservingEncoding(projectJsonPath, afterRaw);
      log(`  ✓ ${projectName}: Updated project.json`, 'green');
      stats.updated++;
    } else {
      log(`  ℹ ${projectName}: Already up to date`, 'yellow');
      stats.upToDate++;
    }
  }

  // --- .NET solution sync (always, matches standalone behaviour) ----------
  syncSolution();

  // --- Summary ------------------------------------------------------------
  log('\n✅ Workspace targets setup complete!', 'green');
  log(
    `   Projects scanned: ${stats.total}  (.NET: ${stats.dotnet}  Node: ${stats.node}  Python: ${stats.python})`,
    'blue',
  );

  const changed = stats.created + stats.updated;
  if (changed > 0) {
    log(`   Created: ${stats.created}  Updated: ${stats.updated}`, 'green');
  }
  if (stats.upToDate > 0) {
    log(`   Already up to date: ${stats.upToDate}`, 'blue');
  }
  if (stats.skipped > 0) {
    log(`   Skipped (no project.json eligible): ${stats.skipped}`, 'yellow');
  }
  log('');
}

main();
