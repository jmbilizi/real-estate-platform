'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseWindowsListenerPid, parsePosixListenerPid, killPidTree } = require('./stop-process');

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
