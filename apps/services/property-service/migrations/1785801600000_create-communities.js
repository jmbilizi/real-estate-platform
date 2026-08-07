exports.shorthands = undefined;

/**
 * Foundation migration: chain-wide helpers plus `communities`.
 *
 * `communities` groups properties managed together (PRD §3).
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  // Only TRUSTED extensions may be created here. A trusted extension can be installed by a database
  // owner; an untrusted one requires SUPERUSER, and property_service_db_user is the owner of
  // property_db, not a superuser. Verified on this instance:
  //   pg_trgm -> trusted = t     postgis -> trusted = f     vector -> trusted = f
  //
  // So `postgis` and `vector` are deliberately NOT created here even defensively — attempting either
  // fails with 42501 "permission denied to create extension" (IF NOT EXISTS does not help when the
  // extension is genuinely absent). Both are provisioned as postgres_sa by
  // infra/k8s/base/configmaps/postgres.configmap.yaml, which is why this service's migrations may
  // depend on them but must never install them.
  pgm.createExtension('pg_trgm', { ifNotExists: true });

  // Created exactly ONCE for the whole chain, and referenced by every other table with
  // `{ function: 'set_updated_at' }` and no definition. pgm.createTrigger() emits a CREATE FUNCTION
  // every time it is handed a body, so defining it per table fails on the first migrate run.
  //
  // A trigger rather than application-side maintenance — which is account-service's convention
  // (Data/AccountDbContext.cs) — because property_db has four independent writers: the REST layer,
  // the seed, a future MLS ingest, and ad-hoc ops SQL. App-side maintenance fails silently for the
  // last two.
  //
  // Scoped to `updated_at` ONLY. Never extend it to listings.last_updated: that column is MLS feed
  // freshness, and a local write advancing it would assert a data currency the feed does not have.
  pgm.createFunction(
    'set_updated_at',
    [],
    { returns: 'trigger', language: 'plpgsql', replace: true },
    'BEGIN NEW.updated_at = now(); RETURN NEW; END;',
  );

  pgm.createTable('communities', {
    // uuidv7() is native in PostgreSQL 18 and time-ordered, so index inserts stay local instead of
    // scattering across the btree the way random uuid_generate_v4() values do. Changing primary-key
    // generation after rows exist is expensive, so it is decided here.
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuidv7()') },
    name: { type: 'text', notNull: true },
    // PRD §6.3 — sample data must be labelled wherever it can be displayed independently, which now
    // includes every level of the hierarchy, not just listings.
    is_sample: { type: 'boolean', notNull: true, default: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTrigger('communities', 'communities_set_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'set_updated_at',
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable('communities');
  pgm.dropFunction('set_updated_at', []);
};
