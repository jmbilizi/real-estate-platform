const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { addToPath } = require('./binary-installer');

test('addToPath without --persist-path changes only this process and GITHUB_PATH', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'addtopath-'));
  const ghPath = path.join(dir, 'github_path');
  fs.writeFileSync(ghPath, '');
  const binDir = path.join(dir, 'bin-under-test');
  const savedPath = process.env.PATH;
  const savedGh = process.env.GITHUB_PATH;
  const savedArgv = process.argv;
  const savedHome = process.env.HOME;
  const savedProfile = process.env.USERPROFILE;
  process.argv = process.argv.filter((a) => a !== '--persist-path');
  process.env.GITHUB_PATH = ghPath;
  try {
    addToPath(binDir);
    assert.ok(process.env.PATH.startsWith(binDir));
    assert.strictEqual(fs.readFileSync(ghPath, 'utf8'), `${binDir}\n`);
    // No shell profile or trigger file is written under the temp dir.
    assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['github_path']);
  } finally {
    process.argv = savedArgv;
    process.env.PATH = savedPath;
    if (savedGh === undefined) delete process.env.GITHUB_PATH;
    else process.env.GITHUB_PATH = savedGh;
    process.env.HOME = savedHome;
    process.env.USERPROFILE = savedProfile;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
