#!/usr/bin/env node

/**
 * Cross-platform, PID-scoped process cleanup.
 *
 * Never kills by image name. `taskkill //F //IM node.exe` matches every process with that name on
 * the machine, which kills other agent lanes' dev servers, watchers, and MCP processes sharing the
 * host. This module resolves a target to one PID (by explicit PID or by the PID currently
 * listening on a port) and kills only that process and its children.
 *
 * Calling `taskkill` through `child_process` (not through Git Bash) also sidesteps the MSYS
 * leading-slash path conversion that forces callers to write `//PID` by hand.
 *
 * See AGENTS.md Repo-Wide Rules #8 and ticket #125.
 */

const { execFileSync } = require('child_process');

/**
 * Parse `netstat -ano` output for the PID listening on `port`.
 *
 * @param {string} output
 * @param {number} port
 * @returns {number | null}
 */
function parseWindowsListenerPid(output, port) {
  const marker = `:${port}`;
  for (const line of output.split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 5) continue;
    const [proto, localAddress, , state, pid] = columns;
    if (proto !== 'TCP') continue;
    if (state !== 'LISTENING') continue;
    if (!localAddress.endsWith(marker)) continue;
    const parsed = Number(pid);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

/**
 * Parse `lsof -t` output (one PID per line) for the first listener.
 *
 * @param {string} output
 * @returns {number | null}
 */
function parsePosixListenerPid(output) {
  const pid = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^\d+$/.test(line));
  return pid ? Number(pid) : null;
}

/**
 * Find the PID listening on `port`, or null if nothing is listening.
 *
 * @param {number} port
 * @param {{ platform?: string }} [options]
 * @returns {number | null}
 */
function findListenerPid(port, options = {}) {
  const platform = options.platform || process.platform;
  try {
    if (platform === 'win32') {
      const output = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf-8' });
      return parseWindowsListenerPid(output, port);
    }
    const output = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
      encoding: 'utf-8',
    });
    return parsePosixListenerPid(output);
  } catch {
    // No process listens on the port. Not an error for a cleanup call.
    return null;
  }
}

/**
 * Parse `tasklist /FO CSV /NH` output into the set of live Windows PIDs.
 *
 * @param {string} output
 * @returns {Set<number>}
 */
function parseTasklistPids(output) {
  const pids = new Set();
  for (const line of output.split(/\r?\n/)) {
    const match = /^"[^"]*","(\d+)"/.exec(line.trim());
    if (match) pids.add(Number(match[1]));
  }
  return pids;
}

/**
 * Map MSYS PIDs to Windows PIDs from `ps -W` output. Column 1 is the MSYS PID and column 4 is
 * WINPID. `taskkill` only knows WINPID. See ticket #288.
 *
 * @param {string} output
 * @returns {Map<number, number>}
 */
function parseMsysPsOutput(output) {
  const map = new Map();
  for (const line of output.split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 4) continue;
    const [msys, , , win] = columns;
    if (/^\d+$/.test(msys) && /^\d+$/.test(win)) map.set(Number(msys), Number(win));
  }
  return map;
}

/**
 * Decide which Windows PID an input PID names. A live Windows PID wins. Otherwise a live MSYS PID
 * maps to its WINPID. Anything else is not found. Never reports success for a PID it cannot name.
 *
 * @param {number} pid
 * @param {{ windowsPids: Set<number>, msysMap: Map<number, number> }} state
 * @returns {{ pid: number, via: 'windows' | 'msys' } | null}
 */
function resolveWindowsPid(pid, state) {
  if (state.windowsPids.has(pid)) return { pid, via: 'windows' };
  const mapped = state.msysMap.get(pid);
  if (mapped !== undefined && state.windowsPids.has(mapped)) return { pid: mapped, via: 'msys' };
  return null;
}

/** Read live Windows PIDs and the MSYS map from the host. MSYS data is empty when `ps` is absent. */
function readWindowsPidState() {
  const windowsPids = parseTasklistPids(
    execFileSync('tasklist', ['/FO', 'CSV', '/NH'], {
      encoding: 'utf-8',
      maxBuffer: 64 * 1024 * 1024,
    }),
  );
  let msysMap = new Map();
  try {
    msysMap = parseMsysPsOutput(execFileSync('ps', ['-W'], { encoding: 'utf-8' }));
  } catch {
    // Not running under MSYS. Only Windows PIDs apply.
  }
  return { windowsPids, msysMap };
}

/**
 * Kill one PID and its child processes. Never touches any other process.
 *
 * @param {number} pid
 * @param {{ platform?: string }} [options]
 * @returns {{ status: 'stopped' | 'gone' | 'failed', message?: string }}
 */
function killPidDetailed(pid, options = {}) {
  const platform = options.platform || process.platform;
  if (!Number.isInteger(pid) || pid <= 0) return { status: 'gone' };

  if (platform === 'win32') {
    try {
      // /T kills the process tree; /F forces termination. Scoped to this PID only.
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'pipe' });
    } catch (error) {
      const text = String(error.stderr || error.stdout || error.message || '').trim();
      // Exit code 128 is taskkill's "process not found".
      if (error.status === 128) return { status: 'gone', message: text };
      return { status: 'failed', message: text };
    }
    return { status: 'stopped' };
  }

  try {
    // Kill children first (scoped to this parent PID, not by image name), then the process.
    execFileSync('pkill', ['-TERM', '-P', String(pid)], { stdio: 'ignore' });
  } catch {
    // No children, or pkill unavailable. Fall through to kill the target PID itself.
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    if (error.code === 'ESRCH') return { status: 'gone' };
    return { status: 'failed', message: error.message };
  }
  return { status: 'stopped' };
}

/** Boolean view of killPidDetailed: true only when a process was stopped. */
function killPidTree(pid, options = {}) {
  return killPidDetailed(pid, options).status === 'stopped';
}

/** Stop whatever is listening on `port`. Returns the PID killed, or null if nothing was there. */
function stopByPort(port, options = {}) {
  const pid = findListenerPid(port, options);
  if (pid === null) return null;
  killPidTree(pid, options);
  return pid;
}

function parseArgs(argv) {
  const result = { pids: [], ports: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--pid') {
      result.pids.push(Number(argv[++i]));
    } else if (arg === '--port') {
      result.ports.push(Number(argv[++i]));
    }
  }
  return result;
}

/**
 * Stop the PIDs and ports named in `argv`. Returns the exit code.
 * An already-gone PID exits 0, because cleanup chains depend on it. Only a real kill failure or a
 * bad argument exits 1.
 */
function run(argv, deps = {}) {
  const platform = deps.platform || process.platform;
  const readState = deps.readState || readWindowsPidState;
  const kill = deps.kill || killPidDetailed;
  const byPort = deps.stopByPort || stopByPort;
  const log = deps.log || console.log;
  const warn = deps.warn || console.error;

  const { pids, ports } = parseArgs(argv);
  if (pids.length === 0 && ports.length === 0) {
    warn('Usage: stop-process.js [--pid <pid>]... [--port <port>]...');
    return 1;
  }

  let exitCode = 0;
  for (const pid of pids) {
    if (!Number.isInteger(pid) || pid <= 0) {
      warn(`Invalid --pid value: ${pid}`);
      exitCode = 1;
      continue;
    }
    let target = pid;
    if (platform === 'win32') {
      const state = readState();
      const resolved = resolveWindowsPid(pid, state);
      if (resolved === null) {
        if (state.msysMap.has(pid)) {
          log(`PID ${pid}: already stopped.`);
        } else {
          warn(
            `PID ${pid}: not found. It never existed or it already exited. Nothing was stopped. ` +
              'On Windows, use the WINPID value (column 4 of `ps -W`), or use --port.',
          );
        }
        continue;
      }
      target = resolved.pid;
      if (resolved.via === 'msys') {
        log(`PID ${pid} is an MSYS PID. Using WINPID ${target}.`);
      }
    }
    const result = kill(target, { platform });
    if (result.status === 'stopped') {
      log(`Stopped PID ${target}.`);
    } else if (result.status === 'gone') {
      log(`PID ${target}: already stopped.`);
    } else {
      warn(`PID ${target}: could not be stopped. ${result.message || ''}`.trim());
      exitCode = 1;
    }
  }

  for (const port of ports) {
    const pid = byPort(port);
    if (pid === null) {
      log(`Port ${port}: nothing listening.`);
    } else {
      log(`Port ${port}: stopped PID ${pid}.`);
    }
  }
  return exitCode;
}

if (require.main === module) {
  process.exitCode = run(process.argv.slice(2));
}

module.exports = {
  parseWindowsListenerPid,
  parsePosixListenerPid,
  findListenerPid,
  parseTasklistPids,
  parseMsysPsOutput,
  resolveWindowsPid,
  killPidTree,
  killPidDetailed,
  run,
  stopByPort,
};
