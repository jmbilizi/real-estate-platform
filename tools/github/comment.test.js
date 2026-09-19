const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { readBodyFile } = require('./comment');

function withTempDir(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cribstop-comment-test-'));
  try {
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('readBodyFile returns the file content', () => {
  withTempDir((dir) => {
    const file = path.join(dir, 'note.md');
    fs.writeFileSync(file, '## Decision\n\nDeclined.\n');
    assert.equal(readBodyFile(file), '## Decision\n\nDeclined.\n');
  });
});

test('readBodyFile rejects a missing path', () => {
  withTempDir((dir) => {
    const file = path.join(dir, 'absent.md');
    assert.throws(() => readBodyFile(file), /--body-file not found/);
  });
});

test('readBodyFile rejects a directory instead of throwing a raw EISDIR', () => {
  withTempDir((dir) => {
    assert.throws(() => readBodyFile(dir), /--body-file is a directory, not a file/);
  });
});

test('readBodyFile rejects a whitespace-only file, so no empty comment is posted', () => {
  withTempDir((dir) => {
    const file = path.join(dir, 'blank.md');
    fs.writeFileSync(file, '   \n\n');
    assert.throws(() => readBodyFile(file), /--body-file is empty/);
  });
});
