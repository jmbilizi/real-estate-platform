const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  isSelfHealEnabled,
  parseOrphanedMigrationName,
  findRenumberedMigrationName,
  renameOrphanedMigrationRecord,
} = require('./migrate-self-heal');

/**
 * A private fixture directory rather than the real migrations/, so a future renumbering there
 * can never flip these assertions for a reason unrelated to migrate-self-heal.js's own logic.
 */
function makeMigrationsDir(fileNames) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-self-heal-spec-'));
  for (const fileName of fileNames) {
    fs.writeFileSync(path.join(dir, fileName), 'exports.up = () => {};\n');
  }
  return dir;
}

describe('migrate-self-heal', () => {
  describe('isSelfHealEnabled', () => {
    it('is enabled only when the flag is set and NODE_ENV is not production', () => {
      expect(isSelfHealEnabled({ PROPERTY_SERVICE_MIGRATION_SELF_HEAL: '1' })).toBe(true);
      expect(
        isSelfHealEnabled({ PROPERTY_SERVICE_MIGRATION_SELF_HEAL: '1', NODE_ENV: 'development' }),
      ).toBe(true);
    });

    it('refuses under NODE_ENV=production even with the flag set', () => {
      expect(
        isSelfHealEnabled({ PROPERTY_SERVICE_MIGRATION_SELF_HEAL: '1', NODE_ENV: 'production' }),
      ).toBe(false);
    });

    it('is disabled when the flag is absent, matching every non-local overlay', () => {
      expect(isSelfHealEnabled({})).toBe(false);
      expect(isSelfHealEnabled({ PROPERTY_SERVICE_MIGRATION_SELF_HEAL: 'true' })).toBe(false);
    });
  });

  describe('parseOrphanedMigrationName', () => {
    it('extracts the recorded name node-pg-migrate rejected', () => {
      const error = new Error(
        'Not run migration 1785801600015_create-bright-staging is preceding already run ' +
          'migration 1785801600014_add-mls-field-address-classification',
      );
      expect(parseOrphanedMigrationName(error)).toBe(
        '1785801600014_add-mls-field-address-classification',
      );
    });

    it('returns null for an unrelated migration failure', () => {
      expect(parseOrphanedMigrationName(new Error('syntax error at or near "CRATE"'))).toBeNull();
    });

    it('returns null when error or its message is missing', () => {
      expect(parseOrphanedMigrationName(undefined)).toBeNull();
      expect(parseOrphanedMigrationName({})).toBeNull();
    });
  });

  describe('findRenumberedMigrationName', () => {
    let migrationsDir;

    afterEach(() => {
      if (migrationsDir) {
        fs.rmSync(migrationsDir, { recursive: true, force: true });
        migrationsDir = undefined;
      }
    });

    it('finds the current file by description when the timestamp changed', () => {
      migrationsDir = makeMigrationsDir([
        '1785801600013_create-mls-attribute-registry.js',
        '1785801600022_add-mls-field-address-classification.js',
        '1785801600023_add-city-state-search-indexes.js',
      ]);

      expect(
        findRenumberedMigrationName(
          '1785801600014_add-mls-field-address-classification',
          migrationsDir,
        ),
      ).toBe('1785801600022_add-mls-field-address-classification');
    });

    it('returns null when the migration was genuinely removed, not renumbered', () => {
      migrationsDir = makeMigrationsDir(['1785801600013_create-mls-attribute-registry.js']);

      expect(findRenumberedMigrationName('1785801600099_removed-migration', migrationsDir)).toBe(
        null,
      );
    });

    it('returns null on an ambiguous description match', () => {
      migrationsDir = makeMigrationsDir([
        '1785801600020_add-thing.js',
        '1785801600021_add-thing.js',
      ]);

      expect(findRenumberedMigrationName('1785801600010_add-thing', migrationsDir)).toBe(null);
    });

    it('returns null for a name with no timestamp separator', () => {
      migrationsDir = makeMigrationsDir(['1785801600013_create-mls-attribute-registry.js']);

      expect(findRenumberedMigrationName('not-a-migration-name', migrationsDir)).toBe(null);
    });

    it('returns null when the orphaned name is a genuine ordering violation, not a rename', () => {
      // A migration inserted with a timestamp earlier than one already applied throws the same
      // checkOrder error shape as a rename, but the "orphaned" name's own file still exists
      // unchanged. Self-heal must refuse this — AGENTS.md requires it to "throw forever".
      migrationsDir = makeMigrationsDir([
        '1785801600010_create-x.js',
        '1785801600012_new-migration.js',
        '1785801600015_create-y.js',
      ]);

      expect(findRenumberedMigrationName('1785801600015_create-y', migrationsDir)).toBe(null);
    });
  });

  describe('renameOrphanedMigrationRecord', () => {
    it('renames the row by name, parameterised', async () => {
      const client = { query: jest.fn().mockResolvedValue(undefined) };

      await renameOrphanedMigrationRecord(client, 'pgmigrations', 'old_name', 'new_name');

      expect(client.query).toHaveBeenCalledWith(
        'UPDATE pgmigrations SET name = $1 WHERE name = $2',
        ['new_name', 'old_name'],
      );
    });
  });
});
