#!/usr/bin/env node

/**
 * SessionStart hook: start the merged-worktree cleanup in a detached background process.
 *
 * Contract: ALWAYS exits 0 right away and prints nothing. The cleanup probes about 50 worktrees,
 * which is too slow to run before a session starts. A stamp file limits it to one run every
 * 10 minutes. The check is not atomic, so sessions that start at the same instant can launch two
 * runs. That is harmless: the second run only fails to remove what the first already removed.
 * The cleanup writes its summary to a log file in the temp directory.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const THROTTLE_MS = 10 * 60 * 1000;
const STAMP_PATH = path.join(os.tmpdir(), 'cribstop-worktree-cleanup.stamp');
const LOG_PATH = path.join(os.tmpdir(), 'cribstop-worktree-cleanup.log');
const RECLAIM_SCRIPT = path.join(__dirname, 'worktree-reclaim.js');

/** Report whether the last run is recent enough to skip this one. A missing stamp means run. */
function isThrottled(lastRunMs, nowMs, windowMs = THROTTLE_MS) {
  if (typeof lastRunMs !== 'number' || !Number.isFinite(lastRunMs)) return false;
  return nowMs - lastRunMs < windowMs;
}

function start() {
  let last = null;
  try {
    last = fs.statSync(STAMP_PATH).mtimeMs;
  } catch {
    /* no stamp: first run */
  }
  if (isThrottled(last, Date.now())) return;

  const log = fs.openSync(LOG_PATH, 'a');
  const child = spawn(process.execPath, [RECLAIM_SCRIPT, '--apply', '--merged-only', '--quiet'], {
    detached: true,
    stdio: ['ignore', log, log],
    windowsHide: true,
  });
  child.on('error', () => {});
  child.unref();
  fs.writeFileSync(STAMP_PATH, String(Date.now()));
}

if (require.main === module) {
  try {
    start();
  } catch {
    // A failed cleanup must never break a session start.
  }
  process.exit(0);
}

module.exports = { isThrottled, THROTTLE_MS };
