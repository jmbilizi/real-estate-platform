'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseMigrationFile,
  findMigrationOrderViolations,
  formatViolation,
  resolvePushBaseRef,
} = require('./migration-order');

const DIR = 'apps/services/property-service/migrations';

function file(prefix, name) {
  return `${DIR}/${prefix}_${name}.js`;
}

test('parseMigrationFile reads the numeric prefix and directory', () => {
  const parsed = parseMigrationFile(file('1785801600038', 'add-listed-at'));
  assert.deepEqual(parsed, { dir: DIR, prefix: 1785801600038n });
});

test('parseMigrationFile ignores non-migration files', () => {
  assert.equal(parseMigrationFile('apps/services/property-service/src/db/index.ts'), null);
  assert.equal(parseMigrationFile(`${DIR}/README.md`), null);
});

test('findMigrationOrderViolations catches #399: a migration numbered below a deployed one', () => {
  // Base branch already has 038 and 039 deployed; the PR adds a stray 037.
  const baseFiles = [file('1785801600038', 'add-listed-at'), file('1785801600039', 'add-index')];
  const addedFiles = [file('1785801600037', 'normalize-neighborhood-values')];

  const violations = findMigrationOrderViolations(addedFiles, baseFiles);

  assert.equal(violations.length, 1);
  assert.equal(violations[0].file, file('1785801600037', 'normalize-neighborhood-values'));
  assert.equal(violations[0].prefix, '1785801600037');
  assert.equal(violations[0].highestBasePrefix, '1785801600039');
  assert.match(formatViolation(violations[0]), /Renumber this migration above 1785801600039/);
});

test('findMigrationOrderViolations rejects a prefix equal to the base high-water mark', () => {
  const baseFiles = [file('1785801600039', 'add-index')];
  const addedFiles = [file('1785801600039', 'duplicate-prefix')];

  const violations = findMigrationOrderViolations(addedFiles, baseFiles);

  assert.equal(violations.length, 1);
});

test('findMigrationOrderViolations passes a migration numbered above the base high-water mark', () => {
  const baseFiles = [file('1785801600039', 'add-index')];
  const addedFiles = [file('1785801600040', 'normalize-neighborhood-values')];

  const violations = findMigrationOrderViolations(addedFiles, baseFiles);

  assert.deepEqual(violations, []);
});

test('findMigrationOrderViolations ignores a brand-new migrations directory', () => {
  const otherDir = 'apps/services/messaging-service/migrations';
  const addedFiles = [`${otherDir}/1_create-messages.js`];

  const violations = findMigrationOrderViolations(addedFiles, []);

  assert.deepEqual(violations, []);
});

// #399's PR check ran against origin/dev before #396 merged 038/039. It saw no conflict.
// #396 then merged and moved dev's tip. #399 merged next, unchanged, straight into the moved
// base. Only a push-time check catches that: compare what the push added against the branch's
// own state right before the push.
test('resolvePushBaseRef uses github.event.before when this checkout knows it', () => {
  const before = 'a'.repeat(40);
  const ref = resolvePushBaseRef(before, (sha) => sha === before);
  assert.equal(ref, before);
});

test('resolvePushBaseRef falls back to HEAD^ on the all-zero SHA (first push of a new branch)', () => {
  const zeroSha = '0'.repeat(40);
  const ref = resolvePushBaseRef(zeroSha, () => true);
  assert.equal(ref, 'HEAD^');
});

test('resolvePushBaseRef falls back to HEAD^ when before is empty', () => {
  const ref = resolvePushBaseRef('', () => true);
  assert.equal(ref, 'HEAD^');
});

test('resolvePushBaseRef falls back to HEAD^ when this checkout does not have the commit', () => {
  const before = 'b'.repeat(40);
  const ref = resolvePushBaseRef(before, () => false);
  assert.equal(ref, 'HEAD^');
});

test('findMigrationOrderViolations keeps directories independent', () => {
  const otherDir = 'apps/services/messaging-service/migrations';
  // property-service is at 39; messaging-service is a separate, lower-numbered lineage.
  const baseFiles = [file('1785801600039', 'add-index'), `${otherDir}/5_create-messages.js`];
  const addedFiles = [`${otherDir}/6_create-threads.js`];

  const violations = findMigrationOrderViolations(addedFiles, baseFiles);

  assert.deepEqual(violations, []);
});
