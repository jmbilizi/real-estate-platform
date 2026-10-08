exports.shorthands = undefined;

/**
 * Adds the `probe` run mode (#715). The worker runs the probe sweep on a schedule and logs each
 * run in `bright_sync_runs` like every other mode.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.dropConstraint('bright_sync_runs', 'bright_sync_runs_mode_check');
  pgm.addConstraint('bright_sync_runs', 'bright_sync_runs_mode_check', {
    check: "mode IN ('incremental', 'backfill', 'reconcile', 'audit', 'probe')",
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.sql("DELETE FROM bright_sync_runs WHERE mode = 'probe'");
  pgm.dropConstraint('bright_sync_runs', 'bright_sync_runs_mode_check');
  pgm.addConstraint('bright_sync_runs', 'bright_sync_runs_mode_check', {
    check: "mode IN ('incremental', 'backfill', 'reconcile', 'audit')",
  });
};
