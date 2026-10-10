'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseWindowsListenerPid,
  parsePosixListenerPid,
  parseTasklistPids,
  parseMsysPsOutput,
  resolveWindowsPid,
  killPidTree,
  run,
} = require('./stop-process');

function runWith(argv, { state, kill, platform = 'win32' }) {
  const out = [];
  const err = [];
  const code = run(argv, {
    platform,
    readState: () => state,
    kill,
    log: (m) => out.push(m),
    warn: (m) => err.push(m),
  });
  return { code, out, err };
}

const NO_STATE = { windowsPids: new Set([100]), msysMap: new Map() };

test('run exits 0 with a warning for a PID that is not found', () => {
  const r = runWith(['--pid', '555'], { state: NO_STATE, kill: () => assert.fail('no kill') });
  assert.equal(r.code, 0);
  assert.match(r.err[0], /not found/);
});

test('run exits 0 with "already stopped" for an MSYS PID whose WINPID exited', () => {
  const state = { windowsPids: new Set([100]), msysMap: new Map([[4232100, 37796]]) };
  const r = runWith(['--pid', '4232100'], { state, kill: () => assert.fail('no kill') });
  assert.equal(r.code, 0);
  assert.match(r.out[0], /already stopped/);
});

test('run exits 0 when the kill finds the process already gone', () => {
  const r = runWith(['--pid', '100'], { state: NO_STATE, kill: () => ({ status: 'gone' }) });
  assert.equal(r.code, 0);
  assert.match(r.out[0], /already stopped/);
});

test('run exits 1 and prints the error text on a real kill failure', () => {
  const r = runWith(['--pid', '100'], {
    state: NO_STATE,
    kill: () => ({ status: 'failed', message: 'Access is denied.' }),
  });
  assert.equal(r.code, 1);
  assert.match(r.err[0], /Access is denied/);
});

test('run exits 0 when a PID is stopped, 1 on a bad argument', () => {
  const ok = runWith(['--pid', '100'], { state: NO_STATE, kill: () => ({ status: 'stopped' }) });
  assert.equal(ok.code, 0);
  assert.equal(runWith(['--pid', 'x'], { state: NO_STATE, kill: () => ({}) }).code, 1);
});

const TASKLIST_SAMPLE =
  '"skaffold.exe","37796","Console","1","62,396 K"\r\n"node.exe","100","Console","1","9 K"\r\n';
const PS_SAMPLE = [
  '      PID    PPID    PGID     WINPID  TTY  UID    STIME COMMAND',
  '  4232100       1 4232100      37796 cons0 197609 10:00:00 /c/tools/skaffold',
].join('\n');

test('parseTasklistPids reads live Windows PIDs from CSV output', () => {
  assert.deepEqual([...parseTasklistPids(TASKLIST_SAMPLE)], [37796, 100]);
});

test('parseMsysPsOutput maps the MSYS PID to WINPID', () => {
  assert.equal(parseMsysPsOutput(PS_SAMPLE).get(4232100), 37796);
});

test('resolveWindowsPid returns null for an unknown PID', () => {
  const state = {
    windowsPids: parseTasklistPids(TASKLIST_SAMPLE),
    msysMap: parseMsysPsOutput(PS_SAMPLE),
  };
  assert.equal(resolveWindowsPid(555, state), null);
});

test('resolveWindowsPid accepts a live Windows PID', () => {
  const state = { windowsPids: parseTasklistPids(TASKLIST_SAMPLE), msysMap: new Map() };
  assert.deepEqual(resolveWindowsPid(37796, state), { pid: 37796, via: 'windows' });
});

test('resolveWindowsPid maps an MSYS PID to its WINPID (#288)', () => {
  const state = {
    windowsPids: parseTasklistPids(TASKLIST_SAMPLE),
    msysMap: parseMsysPsOutput(PS_SAMPLE),
  };
  assert.deepEqual(resolveWindowsPid(4232100, state), { pid: 37796, via: 'msys' });
});

test('resolveWindowsPid rejects an MSYS PID whose WINPID is gone', () => {
  const state = { windowsPids: new Set([100]), msysMap: parseMsysPsOutput(PS_SAMPLE) };
  assert.equal(resolveWindowsPid(4232100, state), null);
});

const NETSTAT_SAMPLE = [
  '',
  '  Proto  Local Address          Foreign Address        State           PID',
  '  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       1234',
  '  TCP    127.0.0.1:8080         0.0.0.0:0              LISTENING       5678',
  '  TCP    0.0.0.0:3002           1.2.3.4:51000          ESTABLISHED     9999',
  '  UDP    0.0.0.0:3000           *:*                                    4321',
].join('\r\n');

test('parseWindowsListenerPid finds the PID listening on the requested port', () => {
  assert.equal(parseWindowsListenerPid(NETSTAT_SAMPLE, 3000), 1234);
  assert.equal(parseWindowsListenerPid(NETSTAT_SAMPLE, 8080), 5678);
});

test('parseWindowsListenerPid ignores a non-LISTENING connection on the same port', () => {
  assert.equal(parseWindowsListenerPid(NETSTAT_SAMPLE, 3002), null);
});

test('parseWindowsListenerPid ignores UDP rows on the same port number', () => {
  // Only the TCP LISTENING row on 3000 should match, never the UDP row.
  assert.equal(parseWindowsListenerPid(NETSTAT_SAMPLE, 3000), 1234);
});

test('parseWindowsListenerPid returns null when nothing listens on the port', () => {
  assert.equal(parseWindowsListenerPid(NETSTAT_SAMPLE, 9000), null);
});

test('parsePosixListenerPid reads the first PID from lsof -t output', () => {
  assert.equal(parsePosixListenerPid('1234\n5678\n'), 1234);
});

test('parsePosixListenerPid returns null for empty output', () => {
  assert.equal(parsePosixListenerPid(''), null);
});

test('killPidTree returns false for an invalid PID without throwing', () => {
  assert.equal(killPidTree(0), false);
  assert.equal(killPidTree(-1), false);
  assert.equal(killPidTree(NaN), false);
});

test('killPidTree returns false, and does not throw, for a PID that no longer exists', () => {
  // A PID this high is never in use, so this simulates the double-cleanup case: the caller
  // targets a process that already exited.
  assert.doesNotThrow(() => {
    assert.equal(killPidTree(999999), false);
  });
});
