const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { addToPath } = require('./binary-installer');

test('addToPath changes only this process and GITHUB_PATH', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'addtopath-'));
  const ghPath = path.join(dir, 'github_path');
  fs.writeFileSync(ghPath, '');
  const binDir = path.join(dir, 'bin-under-test');
  const savedPath = process.env.PATH;
  const savedGh = process.env.GITHUB_PATH;
  process.env.GITHUB_PATH = ghPath;
  try {
    addToPath(binDir);
    assert.ok(process.env.PATH.startsWith(binDir));
    assert.strictEqual(fs.readFileSync(ghPath, 'utf8'), `${binDir}\n`);
  } finally {
    process.env.PATH = savedPath;
    if (savedGh === undefined) delete process.env.GITHUB_PATH;
    else process.env.GITHUB_PATH = savedGh;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('setup scripts contain no persistent PATH write', () => {
  const files = [
    path.join(__dirname, 'binary-installer.js'),
    path.join(__dirname, '..', 'dotnet', 'scripts', 'dotnet-dev-setup.js'),
  ];
  const banned = [
    /SetEnvironmentVariable/,
    /setx\s/i,
    /\.zshrc|\.bashrc|\.bash_profile|\.zprofile/,
    /ExecutionPolicy/i,
    /--persist-path/,
  ];
  for (const file of files) {
    // Strip comments so the doc text about the rule does not trip the check.
    const code = fs
      .readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const re of banned) {
      assert.ok(!re.test(code), `${path.basename(file)} matches ${re}`);
    }
  }
});
