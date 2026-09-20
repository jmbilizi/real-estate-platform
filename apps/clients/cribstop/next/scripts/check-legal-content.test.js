const { execFileSync } = require('child_process');
const path = require('path');

const SCRIPT_PATH = path.join(__dirname, 'check-legal-content.js');

/**
 * Runs as a child process, not a `require`, because the script's failure path is
 * `process.exit(1)` — asserting on real exit codes is what proves the build actually stops.
 */
function runGate() {
  return execFileSync(process.execPath, [SCRIPT_PATH], { encoding: 'utf8' });
}

describe('check-legal-content.js', () => {
  it('fails while a legal content module is a draft placeholder (current state, pending #156)', () => {
    expect(() => runGate()).toThrow(/Command failed/);
  });

  it('reports both content modules by name when both are drafts', () => {
    try {
      runGate();
      throw new Error('expected the gate script to exit non-zero');
    } catch (error) {
      const output = error.stderr ?? '';
      expect(output).toMatch(/privacy\.json/);
      expect(output).toMatch(/terms\.json/);
    }
  });
});
