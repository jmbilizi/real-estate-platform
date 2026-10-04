const migration = require('./migrations/1785801600028_add-bright-feed-tier');

describe('migration 028 feed-tier backfill', () => {
  it('builds one UPDATE per table with the tier as a quoted literal', () => {
    expect(migration.buildTierBackfillSql('production')).toEqual([
      "UPDATE bright_staging_records SET feed_tier = 'production';",
      "UPDATE bright_replication_cursor SET feed_tier = 'production';",
    ]);
  });

  it('doubles single quotes so a value cannot end the literal', () => {
    const [first] = migration.buildTierBackfillSql("x'; DROP TABLE t; --");
    expect(first).toBe("UPDATE bright_staging_records SET feed_tier = 'x''; DROP TABLE t; --';");
  });

  it('up() emits the backfill without pgm.format when BRIGHT_MLS_ENV is set', () => {
    const previous = process.env.BRIGHT_MLS_ENV;
    process.env.BRIGHT_MLS_ENV = 'Test';
    const sql = [];
    const pgm = new Proxy(
      { sql: (s) => sql.push(s) },
      { get: (t, k) => t[k] ?? (() => undefined) },
    );
    try {
      migration.up(pgm);
    } finally {
      if (previous === undefined) delete process.env.BRIGHT_MLS_ENV;
      else process.env.BRIGHT_MLS_ENV = previous;
    }
    expect(sql).toContain("UPDATE bright_staging_records SET feed_tier = 'test';");
  });
});
