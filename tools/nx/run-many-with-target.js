#!/usr/bin/env node

/**
 * Run Nx run-many for projects that have a given target.
 *
 * Why:
 * - `nx run-many --target=X --projects=tag:foo` fails if some projects in that
 *   tag set don't define target X.
 * - For `container-build`, we only want to run projects that actually have a
 *   Dockerfile/target configured.
 *
 * Usage:
 *   node tools/nx/run-many-with-target.js --target=container-build
 *   node tools/nx/run-many-with-target.js --target=container-build --projects=tag:service --tag=dev
 */

const { execSync, spawnSync } = require("child_process");

function readArgValue(argv, name) {
  const eqPrefix = `--${name}=`;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith(eqPrefix)) return arg.slice(eqPrefix.length);
    if (arg === `--${name}` && i + 1 < argv.length) return argv[i + 1];
  }
  return null;
}

function stripArg(argv, name) {
  const stripped = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === `--${name}`) {
      i += 1; // also skip next token (value)
      continue;
    }
    if (arg.startsWith(`--${name}=`)) {
      continue;
    }
    stripped.push(arg);
  }
  return stripped;
}

function runNxJson(command) {
  const output = execSync(command, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(output);
}

function intersect(a, b) {
  const setB = new Set(b);
  return a.filter((x) => setB.has(x));
}

function main() {
  const argv = process.argv.slice(2);
  const target = readArgValue(argv, "target");
  const projectsFilter = readArgValue(argv, "projects");
  const listOnly = argv.includes("--list") || argv.includes("--list-only");

  if (!target) {
    console.error("Missing required argument: --target=<targetName>");
    process.exit(1);
  }

  let projectsWithTarget;
  try {
    projectsWithTarget = runNxJson(`pnpm exec nx show projects --withTarget=${target} --json`);
  } catch (e) {
    const stderr = (e && (e.stderr || e.message)) || "";
    console.error(`[nx] Failed to list projects with target \"${target}\"`);
    if (stderr) console.error(String(stderr));
    process.exit(1);
  }

  let finalProjects = projectsWithTarget;
  if (projectsFilter) {
    let filteredProjects;
    try {
      filteredProjects = runNxJson(`pnpm exec nx show projects --projects=${projectsFilter} --json`);
    } catch (e) {
      const stderr = (e && (e.stderr || e.message)) || "";
      console.error(`[nx] Failed to list projects for filter: --projects=${projectsFilter}`);
      if (stderr) console.error(String(stderr));
      process.exit(1);
    }
    finalProjects = intersect(projectsWithTarget, filteredProjects);
  }

  if (!finalProjects || finalProjects.length === 0) {
    const filterMsg = projectsFilter ? ` (filter: ${projectsFilter})` : "";
    console.log(`[nx] No projects have target \"${target}\"${filterMsg}. Skipping.`);
    process.exit(0);
  }

  if (listOnly) {
    // Newline-separated list to match `nx show projects` default output
    console.log(finalProjects.join("\n"));
    process.exit(0);
  }

  let passThrough = stripArg(argv, "target");
  passThrough = stripArg(passThrough, "projects");
  passThrough = passThrough.filter((x) => x !== "--list" && x !== "--list-only");

  const nxArgs = ["nx", "run-many", `--target=${target}`, `--projects=${finalProjects.join(",")}`, ...passThrough];

  const result = spawnSync("pnpm", ["exec", ...nxArgs], {
    stdio: "inherit",
    shell: true,
  });

  process.exit(result.status ?? 1);
}

main();
