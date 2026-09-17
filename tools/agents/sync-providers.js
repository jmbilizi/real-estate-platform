#!/usr/bin/env node
/**
 * Syncs canonical agentic assets from .agents/ into provider-specific files.
 *
 * Canonical sources (edit these):
 *   .agents/skills/<name>/SKILL.md   — skills (agentskills.io open standard); project-specific
 *                                      skills nest the same shape inside the project, e.g.
 *                                      apps/clients/cribstop/.agents/skills/<name>/SKILL.md
 *   .agents/agents/<name>.md         — subagent definitions (Claude frontmatter format, root only)
 *
 * Generated outputs (never hand-edit):
 *   <base>/.claude/skills/<name>/SKILL.md — pointer for Claude Code (frontmatter copied for
 *                                      discovery, body redirects to the canonical file)
 *   .claude/agents/<name>.md         — full copy for Claude Code (subagent bodies are system
 *                                      prompts, so a redirect would degrade reliability)
 *   AGENTS.md "Project Guides" block  — list of every nested AGENTS.md under apps/ and libs/,
 *                                      between bare project-guides start/end marker lines
 *   <project>/CLAUDE.md               — "@AGENTS.md" import stub next to every nested AGENTS.md
 *   .agents/README.md capability table — rendered from .agents/capability-map.json
 *   .claude/agents/<name>.md tail     — the Claude Code column of that map, appended to each copy
 *   .vscode/settings.json             — chat.agentSkillsLocations = every dir owning .agents/skills
 *
 * Validation (both modes exit 1): every project.json under apps/ or libs/ must have an AGENTS.md
 * in its directory or an ancestor.
 *
 * VS Code Copilot reads .agents/agents/ via chat.agentFilesLocations (static: root only).
 *
 * Usage:
 *   node tools/agents/sync-providers.js           # regenerate (pnpm run agents:sync)
 *   node tools/agents/sync-providers.js --check   # exit 1 on drift (pnpm run agents:check)
 */
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
// The repo's own Prettier, so generated files always pass nx:workspace-format-check.
const prettier = require(require.resolve('prettier', { paths: [repoRoot] }));
const AGENTS_SRC = path.join(repoRoot, '.agents', 'agents');
const AGENTS_OUT = path.join(repoRoot, '.claude', 'agents');

const WALK_SKIP = new Set(['node_modules', '.git', 'dist', '.nx', '.venv', 'coverage', 'tmp']);

// Every directory that owns a `.agents/` dir (repo root plus nested projects).
function findAgentBases(dir, bases = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || WALK_SKIP.has(entry.name)) continue;
    if (entry.name === '.agents') bases.push(dir);
    else if (!entry.name.startsWith('.')) findAgentBases(path.join(dir, entry.name), bases);
  }
  return bases.sort();
}

// Every file named `fileName` under apps/ and libs/, in path order.
function findProjectFiles(fileName) {
  const files = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!WALK_SKIP.has(entry.name) && !entry.name.startsWith('.')) walk(full);
      } else if (entry.name === fileName) {
        files.push(full);
      }
    }
  };
  for (const root of ['apps', 'libs']) walk(path.join(repoRoot, root));
  return files.sort();
}

// A project is guided when an AGENTS.md sits in its directory or in an ancestor below apps/ or
// libs/ (cribstop's project.json lives one level under its guide).
function checkProjectsHaveGuides(guides) {
  const guideDirs = new Set(guides.map((g) => path.dirname(g)));
  for (const projectFile of findProjectFiles('project.json')) {
    let dir = path.dirname(projectFile);
    let found = false;
    while (dir !== repoRoot && dir !== path.dirname(dir)) {
      if (guideDirs.has(dir)) {
        found = true;
        break;
      }
      dir = path.dirname(dir);
    }
    if (!found) {
      problems.push(
        `${rel(projectFile)}: Nx project has no AGENTS.md in its directory or an ancestor — ` +
          'add one (see the new-service skill), then run "pnpm run agents:sync"',
      );
    }
  }
}

const checkMode = process.argv.includes('--check');
const problems = [];

function rel(p) {
  return path.relative(repoRoot, p).replace(/\\/g, '/');
}

function readNormalized(file) {
  // UTF-8 without BOM, LF endings — matches repo formatting rules.
  return fs
    .readFileSync(file, 'utf8')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n');
}

function splitFrontmatter(file) {
  const text = readNormalized(file);
  const match = text.match(/^---\n[\s\S]*?\n---\n/);
  if (!match) {
    problems.push(`${rel(file)}: missing YAML frontmatter`);
    return null;
  }
  return { frontmatter: match[0], body: text.slice(match[0].length).replace(/^\n+/, '') };
}

function frontmatterName(frontmatter, file) {
  const match = frontmatter.match(/^name:\s*(?:'([^']*)'|"([^"]*)"|(\S+))\s*$/m);
  const name = match && (match[1] ?? match[2] ?? match[3]);
  if (!name) problems.push(`${rel(file)}: frontmatter has no "name" field`);
  return name ?? null;
}

function listDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

async function applyOutput(outFile, rawContent, expected) {
  expected.add(outFile);
  const config = await prettier.resolveConfig(outFile);
  const content = await prettier.format(rawContent, { ...config, filepath: outFile });
  const current = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : null;
  if (current === content) return;
  if (checkMode) {
    problems.push(
      `${rel(outFile)} is ${current === null ? 'missing' : 'stale'} — run "pnpm run agents:sync"`,
    );
    return;
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, content, 'utf8');
  console.log(`✓ wrote ${rel(outFile)}`);
}

function pruneOrphans(outDir, expected, matcher) {
  if (!fs.existsSync(outDir)) return;
  for (const entry of fs.readdirSync(outDir, { withFileTypes: true })) {
    const full = path.join(outDir, entry.name);
    const candidate = matcher(entry, full);
    if (!candidate || expected.has(candidate)) continue;
    if (checkMode) {
      problems.push(`${rel(candidate)} has no canonical source in .agents/ — run agents:sync`);
    } else {
      fs.rmSync(entry.isDirectory() ? full : candidate, { recursive: true, force: true });
      console.log(`✓ removed orphan ${rel(candidate)}`);
    }
  }
}

const GENERATED_NOTE =
  '<!-- GENERATED by tools/agents/sync-providers.js — do not edit; edit the canonical file';

// --- Skills: pointer files (frontmatter for discovery, body redirects) ---
async function syncSkills(base) {
  const skillsSrc = path.join(base, '.agents', 'skills');
  const skillsOut = path.join(base, '.claude', 'skills');
  const expectedSkillFiles = new Set();
  for (const name of listDirs(skillsSrc)) {
    const srcFile = path.join(skillsSrc, name, 'SKILL.md');
    if (!fs.existsSync(srcFile)) {
      problems.push(`${rel(path.join(skillsSrc, name))}: directory has no SKILL.md`);
      continue;
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name) || name.length > 64) {
      problems.push(
        `${rel(srcFile)}: skill directory name must be lowercase-hyphen (max 64 chars)`,
      );
    }
    const parts = splitFrontmatter(srcFile);
    if (!parts) continue;
    const declared = frontmatterName(parts.frontmatter, srcFile);
    if (declared && declared !== name) {
      problems.push(`${rel(srcFile)}: frontmatter name "${declared}" != directory "${name}"`);
    }
    const canonical = rel(srcFile);
    const content =
      parts.frontmatter +
      '\n' +
      `${GENERATED_NOTE} in ${canonical} and run "pnpm run agents:sync". -->\n` +
      '\n' +
      'Provider pointer for Claude Code — read the canonical skill file below (path relative to\n' +
      'the repo root) and follow it exactly:\n' +
      '\n' +
      `\`${canonical}\`\n`;
    await applyOutput(path.join(skillsOut, name, 'SKILL.md'), content, expectedSkillFiles);
  }
  pruneOrphans(skillsOut, expectedSkillFiles, (entry, full) =>
    entry.isDirectory() ? path.join(full, 'SKILL.md') : null,
  );
}

// --- Marker-delimited blocks inside hand-written markdown ---
// A marker counts only as a bare line, so prose that quotes it (`<!-- x:start -->` in backticks)
// is ignored. Exactly one of each is required; anything else is refused rather than guessed at.
function findMarkerBlock(text, startMarker, endMarker, label) {
  const lines = text.split('\n');
  const starts = lines.flatMap((l, i) => (l.trim() === startMarker ? [i] : []));
  const ends = lines.flatMap((l, i) => (l.trim() === endMarker ? [i] : []));
  if (starts.length !== 1 || ends.length !== 1 || ends[0] < starts[0]) {
    problems.push(
      `${label}: needs exactly one bare ${startMarker} line followed by one bare ${endMarker} line`,
    );
    return null;
  }
  return { lines, start: starts[0], end: ends[0] };
}

async function replaceMarkerBlock(file, startMarker, endMarker, bodyLines, what) {
  const text = readNormalized(file);
  const block = findMarkerBlock(text, startMarker, endMarker, rel(file));
  if (!block) return;
  const next = [
    ...block.lines.slice(0, block.start + 1),
    '',
    ...bodyLines,
    '',
    ...block.lines.slice(block.end),
  ].join('\n');
  if (next === text) return; // unchanged — skip the prettier pass
  const config = await prettier.resolveConfig(file);
  const content = await prettier.format(next, { ...config, filepath: file });
  if (content === fs.readFileSync(file, 'utf8')) return;
  if (checkMode) {
    problems.push(`${rel(file)} ${what} is stale — run "pnpm run agents:sync"`);
    return;
  }
  fs.writeFileSync(file, content, 'utf8');
  console.log(`✓ wrote ${rel(file)} (${what})`);
}

// --- Root AGENTS.md: regenerate the "Project Guides" list from the nested AGENTS.md files ---
async function syncProjectGuides(guides) {
  const lines = [];
  for (const guide of guides) {
    const h1 = readNormalized(guide).match(/^# (.+)$/m);
    if (!h1) {
      problems.push(`${rel(guide)}: no H1 title (used for the root AGENTS.md guide list)`);
      return; // don't write a list with a fallback entry that validation then rejects
    }
    lines.push(`- \`${rel(guide)}\` — ${h1[1].trim()}`);
  }
  await replaceMarkerBlock(
    path.join(repoRoot, 'AGENTS.md'),
    '<!-- project-guides:start -->',
    '<!-- project-guides:end -->',
    lines,
    'Project Guides',
  );
}

// --- Capability map: one JSON source, rendered for humans (README) and for Claude Code ---
function loadCapabilityMap() {
  const file = path.join(repoRoot, '.agents', 'capability-map.json');
  try {
    return JSON.parse(readNormalized(file)).capabilities;
  } catch (err) {
    problems.push(`${rel(file)}: ${err.message}`);
    return [];
  }
}

async function syncCapabilityReadme(capabilities) {
  const lines = [
    '| Capability (as written in `.agents/`) | Claude Code | VS Code Copilot / other |',
    '| --- | --- | --- |',
    ...capabilities.map((c) => `| ${c.capability} | ${c['claude-code']} | ${c.other} |`),
  ];
  await replaceMarkerBlock(
    path.join(repoRoot, '.agents', 'README.md'),
    '<!-- capability-map:start -->',
    '<!-- capability-map:end -->',
    lines,
    'Capability map',
  );
}

function claudeCapabilitySection(capabilities) {
  return [
    '## Capability map (Claude Code)',
    '',
    'Generated from `.agents/capability-map.json`. Where the text above names a capability, use:',
    '',
    ...capabilities.map((c) => `- **${c.capability}**: ${c['claude-code']}`),
    '',
  ].join('\n');
}

// --- Nested CLAUDE.md stubs: Claude Code loads CLAUDE.md per directory, so every nested
// AGENTS.md needs an import stub beside it. Stubs are generated, so drift is detected.
const CLAUDE_STUB =
  '@AGENTS.md\n\nCanonical project guide is the sibling `AGENTS.md` (imported above). Edit that file, not this stub.\n';

async function syncClaudeStubs(guides) {
  const expected = new Set();
  for (const guide of guides) {
    await applyOutput(path.join(path.dirname(guide), 'CLAUDE.md'), CLAUDE_STUB, expected);
  }
}

// --- VS Code: chat.agentSkillsLocations must name every dir that owns .agents/skills ---
async function syncVsCodeSkillLocations(bases) {
  const file = path.join(repoRoot, '.vscode', 'settings.json');
  if (!fs.existsSync(file)) return;
  let settings;
  try {
    settings = JSON.parse(readNormalized(file));
  } catch (err) {
    problems.push(`${rel(file)}: not strict JSON (${err.message}) — the sync cannot update it`);
    return;
  }
  const wanted = {};
  for (const base of bases) {
    if (!fs.existsSync(path.join(base, '.agents', 'skills'))) continue;
    wanted[rel(path.join(base, '.agents', 'skills'))] = true;
  }
  settings['chat.agentSkillsLocations'] = wanted;
  const config = await prettier.resolveConfig(file);
  const content = await prettier.format(JSON.stringify(settings, null, 2), {
    ...config,
    filepath: file,
  });
  if (content === fs.readFileSync(file, 'utf8')) return;
  if (checkMode) {
    problems.push('.vscode/settings.json chat.agentSkillsLocations is stale — run agents:sync');
    return;
  }
  fs.writeFileSync(file, content, 'utf8');
  console.log('✓ wrote .vscode/settings.json (chat.agentSkillsLocations)');
}

async function main() {
  const bases = findAgentBases(repoRoot);
  for (const base of bases) {
    await syncSkills(base);
  }
  const guides = findProjectFiles('AGENTS.md');
  checkProjectsHaveGuides(guides);
  await syncProjectGuides(guides);
  await syncClaudeStubs(guides);
  await syncVsCodeSkillLocations(bases);
  const capabilities = loadCapabilityMap();
  await syncCapabilityReadme(capabilities);

  // --- Agents: full copies (the body is the subagent's system prompt), plus the Claude Code
  // column of the capability map so the prompt names invocable tools without the canonical
  // body naming any provider.
  const expectedAgentFiles = new Set();
  if (fs.existsSync(AGENTS_SRC)) {
    const files = fs
      .readdirSync(AGENTS_SRC)
      .filter((f) => f.endsWith('.md'))
      .sort();
    for (const file of files) {
      const srcFile = path.join(AGENTS_SRC, file);
      const parts = splitFrontmatter(srcFile);
      if (!parts) continue;
      frontmatterName(parts.frontmatter, srcFile);
      const canonical = `.agents/agents/${file}`;
      const content =
        parts.frontmatter +
        '\n' +
        `${GENERATED_NOTE} in ${canonical} and run "pnpm run agents:sync". -->\n` +
        '\n' +
        parts.body.replace(/\n*$/, '\n\n') +
        claudeCapabilitySection(capabilities);
      await applyOutput(path.join(AGENTS_OUT, file), content, expectedAgentFiles);
    }
  }
  pruneOrphans(AGENTS_OUT, expectedAgentFiles, (entry, full) =>
    entry.isFile() && entry.name.endsWith('.md') ? full : null,
  );

  if (problems.length > 0) {
    console.error('\nAgentic config problems:');
    for (const p of problems) console.error(`  ✗ ${p}`);
    process.exit(1);
  }
  console.log(checkMode ? '✓ agentic config in sync' : '✓ agents:sync complete');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
