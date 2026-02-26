#!/usr/bin/env node

/**
 * Auto-Tag Projects (Namespaced)
 *
 * Scans all Nx projects and applies a consistent, namespaced tag taxonomy.
 *
 * AUTO-DETECTED dimensions (set or corrected on every run):
 *   runtime:    node | dotnet | python        — based on project files & executors
 *   type:       service | client | lib | gateway — based on project role
 *   platform:   web | server | mobile          — based on deployment target (omitted = agnostic)
 *
 * MANUAL dimensions (placeholder added if missing, never overwritten):
 *   scope:      business domain (accounts, messaging, properties, shared, client, ...)
 *   framework:  tech stack (next, expo, fastapi, express, ocelot, aspnetcore, ...)
 *   devteam:    owning team
 *
 * Called by `npm run nx:reset` after setup-workspace-targets.js.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const colors = {
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  red: "\x1b[31m",
  reset: "\x1b[0m",
};

function log(msg, color = "reset") {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

const rootDir = process.cwd();

// Disable daemon – avoids stale graph issues when setup-workspace-targets.js
// just created project.json files in the same nx:reset run.
const nxEnv = { ...process.env, NX_DAEMON: "false" };

function writeFilePreservingEncoding(filePath, content) {
  let hasBOM = false;
  let lineEnding = "\n";

  if (fs.existsSync(filePath)) {
    const buf = fs.readFileSync(filePath);
    hasBOM = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
    const original = buf.toString("utf8");
    lineEnding = original.includes("\r\n") ? "\r\n" : "\n";
  }

  if (lineEnding === "\r\n") {
    content = content.replace(/\r?\n/g, "\r\n");
  } else {
    content = content.replace(/\r\n/g, "\n");
  }

  const out = hasBOM
    ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(content, "utf8")])
    : Buffer.from(content, "utf8");
  fs.writeFileSync(filePath, out);
}

// ---------------------------------------------------------------------------
// Nx helpers
// ---------------------------------------------------------------------------

function getAllProjects() {
  try {
    const output = execSync("npx nx show projects --json", {
      encoding: "utf8",
      env: nxEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(output);
  } catch (error) {
    log(`Error getting projects: ${error.message}`, "red");
    return [];
  }
}

function getProjectConfig(projectName) {
  try {
    const output = execSync(`npx nx show project ${projectName} --json`, {
      encoding: "utf8",
      env: nxEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(output);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tag helpers
// ---------------------------------------------------------------------------

/** Get the value of a namespaced tag, e.g. getTagValue(tags, "runtime") → "node" */
function getTagValue(tags, prefix) {
  const tag = tags.find((t) => t.startsWith(`${prefix}:`));
  return tag ? tag.substring(prefix.length + 1) : null;
}

/** Remove all tags matching a prefix */
function removeTagsWithPrefix(tags, prefix) {
  return tags.filter((t) => !t.startsWith(`${prefix}:`));
}

/** Set a namespaced tag, replacing any existing value for that prefix */
function setTag(tags, prefix, value) {
  const filtered = removeTagsWithPrefix(tags, prefix);
  filtered.push(`${prefix}:${value}`);
  return filtered;
}

/** Remove legacy bare tags that are being replaced by namespaced equivalents */
const LEGACY_BARE_TAGS = new Set([
  "node",
  "dotnet",
  "python",
  "service",
  "lib",
  "next",
  "expo",
  "express",
  "api",
  "client",
  "react",
  "fastapi",
  "django",
  "webapi",
  "blazor",
]);

/** Old namespaced tags that don't fit the new taxonomy */
const LEGACY_NAMESPACED_TAGS = new Set(["client:platform", "type:app"]);

function removeLegacyTags(tags) {
  return tags.filter((t) => !LEGACY_BARE_TAGS.has(t) && !LEGACY_NAMESPACED_TAGS.has(t));
}

// ---------------------------------------------------------------------------
// Detection: runtime
// ---------------------------------------------------------------------------

function detectRuntime(projectConfig) {
  const targets = projectConfig.targets || {};
  const executors = [];
  const commands = [];

  for (const name in targets) {
    const t = targets[name];
    if (t.executor) executors.push(t.executor);
    if (t.options?.command) commands.push(t.options.command);
  }

  const executorStr = executors.join(" ");
  const commandStr = commands.join(" ");
  const projectRoot = path.join(rootDir, projectConfig.root);

  // Python — executor-based (check first, most specific)
  if (executorStr.includes("@nxlv/python")) return "python";

  // .NET — executor or command or file based
  if (executorStr.includes("@nx/dotnet") || commandStr.includes("dotnet")) return "dotnet";
  try {
    if (fs.readdirSync(projectRoot).some((f) => /\.(csproj|fsproj|vbproj)$/.test(f))) return "dotnet";
  } catch {}

  // Node — executor, command, or file based
  if (
    executorStr.includes("@nx/node") ||
    executorStr.includes("@nx/express") ||
    executorStr.includes("@nx/next") ||
    executorStr.includes("@nx/react") ||
    executorStr.includes("@nx/web") ||
    executorStr.includes("@nx/js") ||
    executorStr.includes("@nx/jest") ||
    executorStr.includes("@nx/eslint") ||
    executorStr.includes("@nx/expo")
  ) {
    return "node";
  }
  if (/\b(eslint|jest|prettier|tsc |tsc--|next |expo )\b/.test(commandStr)) return "node";
  try {
    if (fs.readdirSync(projectRoot).some((f) => f === "package.json" || f === "tsconfig.json")) return "node";
  } catch {}

  // Python — file based (fallback)
  try {
    if (fs.existsSync(path.join(projectRoot, "pyproject.toml"))) return "python";
  } catch {}

  return null;
}

// ---------------------------------------------------------------------------
// Detection: type
// ---------------------------------------------------------------------------

function detectType(projectConfig) {
  const root = (projectConfig.root || "").replace(/\\/g, "/");
  const isLibPath = root.startsWith("libs/") || root.includes("/libs/");
  const isLibType = projectConfig.projectType === "library";

  // Libraries
  if (isLibPath || isLibType) return "lib";

  // Folder-based detection under apps/
  if (/^apps\/clients(\/|$)/.test(root)) return "client";
  if (/^apps\/services(\/|$)/.test(root)) return "service";
  if (/^apps\/databases(\/|$)/.test(root)) return "database";

  // Gateway — name-based fallback
  const name = projectConfig.name || "";
  if (name.includes("gateway")) return "gateway";

  // Everything else under apps/ → service
  return "service";
}

// ---------------------------------------------------------------------------
// Detection: platform
// ---------------------------------------------------------------------------

function detectPlatform(projectConfig, runtime, type) {
  const targets = projectConfig.targets || {};
  const executors = Object.values(targets)
    .map((t) => t.executor || "")
    .join(" ");
  const commands = Object.values(targets)
    .map((t) => t.options?.command || "")
    .join(" ");

  // Web — Next.js
  if (executors.includes("@nx/next") || commands.includes("next ")) return "web";

  // Mobile — Expo
  if (executors.includes("@nx/expo") || commands.includes("expo ")) return "mobile";

  // Server — backend services/gateways
  if ((type === "service" || type === "gateway") && (runtime === "dotnet" || runtime === "python")) {
    return "server";
  }

  // Node.js backend services (express, etc.)
  if (type === "service" && runtime === "node") {
    if (executors.includes("@nx/express") || commands.includes("express")) return "server";
  }

  // Libraries and ambiguous projects — no platform (agnostic)
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  log("\n🏷️  Auto-tagging projects...\n", "blue");

  const projects = getAllProjects();
  let taggedCount = 0;
  let processedCount = 0;
  const warnings = [];

  for (const projectName of projects) {
    const config = getProjectConfig(projectName);
    if (!config) continue;

    // Skip companion test subfolders — managed by parent project
    const posixRoot = (config.root || "").replace(/\\/g, "/");
    if (/\/Tests$/i.test(posixRoot)) {
      const parentDir = path.join(rootDir, posixRoot.replace(/\/Tests$/i, ""));
      try {
        if (fs.readdirSync(parentDir).some((f) => f.endsWith(".csproj"))) continue;
      } catch {}
    }

    processedCount++;

    // Read current project.json
    const projectJsonPath = path.join(rootDir, config.root, "project.json");
    if (!fs.existsSync(projectJsonPath)) continue;

    const raw = fs.readFileSync(projectJsonPath, "utf8");
    const projectJson = JSON.parse(raw);
    let tags = projectJson.tags || [];

    // --- Step 1: Remove legacy bare tags ---
    tags = removeLegacyTags(tags);

    // --- Step 2: Auto-detect and set runtime ---
    const runtime = detectRuntime(config);
    if (runtime) {
      tags = setTag(tags, "runtime", runtime);
    } else {
      warnings.push(`${projectName}: Could not detect runtime`);
    }

    // --- Step 3: Auto-detect and set type ---
    const type = detectType(config);
    tags = setTag(tags, "type", type);

    // --- Step 4: Auto-detect platform (may be null = agnostic) ---
    const platform = detectPlatform(config, runtime, type);
    if (platform) {
      tags = setTag(tags, "platform", platform);
    } else {
      // Remove stale platform tag if project is now agnostic
      tags = removeTagsWithPrefix(tags, "platform");
    }

    // --- Step 5: Manual dimensions — add placeholder if missing ---
    if (!getTagValue(tags, "scope")) {
      tags.push("scope:unassigned");
      warnings.push(`${projectName}: Missing scope: → added scope:unassigned`);
    }

    if (!getTagValue(tags, "framework")) {
      tags.push("framework:unassigned");
      warnings.push(`${projectName}: Missing framework: → added framework:unassigned`);
    }

    if (!getTagValue(tags, "devteam")) {
      tags.push("devteam:unassigned");
      warnings.push(`${projectName}: Missing devteam: → added devteam:unassigned`);
    }

    // --- Step 6: Sort tags by dimension for consistency ---
    const dimensionOrder = ["runtime", "type", "platform", "framework", "scope", "devteam"];
    tags.sort((a, b) => {
      const aIdx = dimensionOrder.findIndex((d) => a.startsWith(`${d}:`));
      const bIdx = dimensionOrder.findIndex((d) => b.startsWith(`${d}:`));
      const aOrder = aIdx >= 0 ? aIdx : dimensionOrder.length;
      const bOrder = bIdx >= 0 ? bIdx : dimensionOrder.length;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.localeCompare(b);
    });

    // --- Step 7: Write back if changed ---
    projectJson.tags = tags;
    const newContent = JSON.stringify(projectJson, null, 2) + "\n";

    // Normalize for comparison
    const normalizedOld = raw.replace(/\r\n/g, "\n");
    const normalizedNew = newContent.replace(/\r\n/g, "\n");

    if (normalizedNew !== normalizedOld) {
      writeFilePreservingEncoding(projectJsonPath, newContent);
      const tagSummary = tags.join(", ");
      log(`✓ ${projectName}: ${tagSummary}`, "green");
      taggedCount++;
    }
  }

  // --- Summary ---
  log(`\n✅ Auto-tagging complete!`, "green");
  log(`   Processed: ${processedCount} projects`, "blue");
  log(`   Tagged/updated: ${taggedCount} projects`, "blue");

  if (warnings.length > 0) {
    log(`\n⚠  Warnings:`, "yellow");
    for (const w of warnings) {
      log(`   ${w}`, "yellow");
    }
  }

  if (taggedCount > 0) {
    log(`\n💡 Tip: Your nx:*-lint, nx:*-test, and nx:*-build commands use tag:runtime:* selectors.`, "blue");
  }
}

main();
