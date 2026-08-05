exports.shorthands = undefined;

/**
 * `communities`: higher-level entity grouping multiple properties managed
 * together (PRD §3). `uuid-ossp` is already enabled on `property_db`
 * (infra/k8s/base/configmaps/postgres.configmap.yaml) — no CREATE EXTENSION
 * needed here, but we add IF NOT EXISTS defensively so this migration also
 * runs cleanly against any other Postgres instance.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createExtension('uuid-ossp', { ifNotExists: true });

  pgm.createTable('communities', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    name: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('communities');
};
