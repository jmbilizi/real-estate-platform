#!/usr/bin/env node

/**
 * Setup Standard Targets
 *
 * Goal:
 * - Keep `project.json` self-documenting by explicitly listing common targets.
 * - Only add targets that make sense for the project/language.
 * - Enforce `container-build` ONLY when a `Dockerfile` exists at project root.
 *
 * Current behavior (intentionally conservative):
 * - Node projects: ensure `lint`, `type-check`, `format`, `format-check`, `test` exist.
 *   (Adds missing targets only; does not override existing ones.)
 * - All projects: add/remove `container-build` based on Dockerfile presence.
 *
 * Notes:
 * - Nx caching is preserved via `nx.json` targetDefaults for type-check/format.
 * - For `lint`, we set `cache: true` on the generated target (to match Nx's
 *   inferred eslint behavior).
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

function hasFlag(argv, name) {
  return argv.includes(name);
}

function toPosix(p) {
  return p.replace(/\\/g, "/");
}

function writeFilePreservingEncoding(filePath, content) {
  let hasBOM = false;
  let lineEnding = "\n";

  if (fs.existsSync(filePath)) {
    const originalBuffer = fs.readFileSync(filePath);
    hasBOM =
      originalBuffer.length >= 3 &&
      originalBuffer[0] === 0xef &&
      originalBuffer[1] === 0xbb &&
      originalBuffer[2] === 0xbf;

    const originalContent = originalBuffer.toString("utf8");
    lineEnding = originalContent.includes("\r\n") ? "\r\n" : "\n";
  } else {
    lineEnding = content.includes("\r\n") ? "\r\n" : "\n";
  }

  if (lineEnding === "\r\n") {
    content = content.replace(/\r?\n/g, "\r\n");
  } else {
    content = content.replace(/\r\n/g, "\n");
  }

  const outputBuffer = hasBOM
    ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(content, "utf8")])
    : Buffer.from(content, "utf8");

  fs.writeFileSync(filePath, outputBuffer);
}

function runJson(command) {
  const output = execSync(command, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(output);
}

function fileExists(rootDir, relativePath) {
  return fs.existsSync(path.join(rootDir, relativePath));
}

function isNodeProject(projectConfig, projectRootAbs) {
  const tags = projectConfig.tags || [];
  if (tags.includes("node")) return true;
  if (fileExists(projectRootAbs, "package.json")) return true;
  if (fileExists(projectRootAbs, "tsconfig.json")) return true;
  return false;
}

function isEligibleForAutoProjectJson(projectRootRel) {
  const normalized = toPosix(projectRootRel || "");
  // Keep this conservative to avoid churning tooling/config folders.
  return normalized.startsWith("apps/") || normalized.startsWith("libs/");
}

function createMinimalNodeProjectJson(projectName, effectiveProjectConfig, projectRootRel, workspaceRoot) {
  const projectRootAbs = path.join(workspaceRoot, projectRootRel);
  const schemaRel = toPosix(
    path.relative(projectRootAbs, path.join(workspaceRoot, "node_modules/nx/schemas/project-schema.json")),
  );

  const inferredProjectType =
    effectiveProjectConfig.projectType || (toPosix(projectRootRel).startsWith("apps/") ? "application" : "library");

  return {
    name: projectName,
    $schema: schemaRel,
    sourceRoot: toPosix(projectRootRel),
    projectType: inferredProjectType,
    tags: Array.isArray(effectiveProjectConfig.tags) ? effectiveProjectConfig.tags : [],
    targets: {},
  };
}

function ensureNodeTargets(projectJson, projectName, projectRootRel, projectRootAbs, workspaceRoot) {
  projectJson.targets = projectJson.targets || {};

  const prettierConfigRel = toPosix(
    path.relative(projectRootAbs, path.join(workspaceRoot, "tools/node/configs/prettier-config.js")),
  );
  const tsconfigRel = `${toPosix(projectRootRel)}/tsconfig.json`;

  // lint
  if (!projectJson.targets.lint) {
    projectJson.targets.lint = {
      executor: "nx:run-commands",
      cache: true,
      options: {
        command: "eslint .",
        cwd: toPosix(projectRootRel),
      },
    };
  }

  // type-check
  if (!projectJson.targets["type-check"] && fileExists(projectRootAbs, "tsconfig.json")) {
    projectJson.targets["type-check"] = {
      executor: "nx:run-commands",
      options: {
        command: `tsc --noEmit -p ${tsconfigRel}`,
        cwd: ".",
      },
    };
  }

  // format
  if (!projectJson.targets.format) {
    projectJson.targets.format = {
      executor: "nx:run-commands",
      options: {
        command: `prettier --write --config ${prettierConfigRel} .`,
        cwd: toPosix(projectRootRel),
      },
    };
  }

  // format-check
  if (!projectJson.targets["format-check"]) {
    projectJson.targets["format-check"] = {
      executor: "nx:run-commands",
      options: {
        command: `prettier --check --config ${prettierConfigRel} .`,
        cwd: toPosix(projectRootRel),
      },
    };
  }

  // test
  if (!projectJson.targets.test) {
    projectJson.targets.test = {
      executor: "nx:run-commands",
      cache: true,
      options: {
        command: "jest --passWithNoTests",
        cwd: toPosix(projectRootRel),
      },
    };
  }
}

function ensureContainerBuildTarget(projectJson, hasDockerfile) {
  projectJson.targets = projectJson.targets || {};

  if (hasDockerfile) {
    if (!projectJson.targets["container-build"]) {
      projectJson.targets["container-build"] = {
        executor: "nx:run-commands",
        options: {
          command: "node tools/docker/build-image.js {projectName} --tag={args.tag}",
          cwd: ".",
        },
      };
    }
  } else {
    if (projectJson.targets["container-build"]) {
      delete projectJson.targets["container-build"];
    }
  }
}

function main() {
  const workspaceRoot = process.cwd();
  const createMissing = hasFlag(process.argv.slice(2), "--create-missing");
  const projectNames = runJson("pnpm exec nx show projects --json");

  const stats = {
    totalProjects: projectNames.length,
    eligibleProjects: 0,
    nodeProjects: 0,
    skippedMissingProjectJson: 0,
    createdProjectJson: 0,
    updatedProjectJson: 0,
  };

  for (const projectName of projectNames) {
    const effective = runJson(`pnpm exec nx show project ${projectName} --json`);
    const projectRootRel = effective.root;
    const projectRootAbs = path.join(workspaceRoot, projectRootRel);
    const projectJsonPath = path.join(projectRootAbs, "project.json");

    const projectJsonExists = fs.existsSync(projectJsonPath);
    const isNode = isNodeProject(effective, projectRootAbs);
    if (isNode) stats.nodeProjects += 1;

    if (!projectJsonExists) {
      if (!createMissing || !isNode || !isEligibleForAutoProjectJson(projectRootRel)) {
        // Default behavior stays low-churn: don't generate new project.json
        // unless explicitly enabled and clearly safe.
        stats.skippedMissingProjectJson += 1;
        continue;
      }
    }

    stats.eligibleProjects += 1;

    const beforeRaw = projectJsonExists ? fs.readFileSync(projectJsonPath, "utf8") : "";
    const projectJson = projectJsonExists
      ? JSON.parse(beforeRaw)
      : createMinimalNodeProjectJson(projectName, effective, projectRootRel, workspaceRoot);

    // Enforce container-build solely based on Dockerfile presence.
    const hasDockerfile = fs.existsSync(path.join(projectRootAbs, "Dockerfile"));
    ensureContainerBuildTarget(projectJson, hasDockerfile);

    // Node standard targets (only when it makes sense).
    if (isNode) {
      ensureNodeTargets(projectJson, projectName, projectRootRel, projectRootAbs, workspaceRoot);
    }

    const afterRaw = JSON.stringify(projectJson, null, 2) + "\n";
    if (!projectJsonExists || afterRaw !== beforeRaw.replace(/\r\n/g, "\n")) {
      writeFilePreservingEncoding(projectJsonPath, afterRaw);
      if (!projectJsonExists) {
        stats.createdProjectJson += 1;
      } else {
        stats.updatedProjectJson += 1;
      }
    }
  }

  const totalChanged = stats.createdProjectJson + stats.updatedProjectJson;
  if (totalChanged > 0) {
    console.log(
      `[nx] Updated standard targets for ${totalChanged} project(s) (created: ${stats.createdProjectJson}, updated: ${stats.updatedProjectJson}).`,
    );
  } else {
    console.log("[nx] Standard targets already up to date.");
  }

  console.log(
    `[nx] Scanned ${stats.totalProjects} Nx project(s); eligible: ${stats.eligibleProjects}; node: ${stats.nodeProjects}; skipped-missing-project.json: ${stats.skippedMissingProjectJson}.`,
  );
}

// Export for reuse by the unified workspace targets script
module.exports = {
  toPosix,
  writeFilePreservingEncoding,
  isNodeProject,
  isEligibleForAutoProjectJson,
  createMinimalNodeProjectJson,
  ensureNodeTargets,
  ensureContainerBuildTarget,
};

// Run standalone
if (require.main === module) {
  main();
}
