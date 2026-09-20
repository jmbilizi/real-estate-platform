const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findDraftFiles } = require('./check-legal-content');

const SCRIPT_PATH = path.join(__dirname, 'check-legal-content.js');

/**
 * Runs as a child process, not a `require`, because the script's failure path is
 * `process.exit(1)` — asserting on a real exit code is what proves the build actually stops.
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

  /**
   * Exercises `findDraftFiles` against fixture modules, not the real content, so the success
   * path stays covered after #156 sets the real `isDraft` values to false and the two tests
   * above are rewritten for the approved-copy state.
   */
  describe('findDraftFiles', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legal-content-gate-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function writeModule(fileName, isDraft) {
      fs.writeFileSync(path.join(tmpDir, fileName), JSON.stringify({ isDraft }));
    }

    it('returns no files once every module has isDraft: false', () => {
      writeModule('privacy.json', false);
      writeModule('terms.json', false);

      expect(findDraftFiles(tmpDir, ['privacy.json', 'terms.json'])).toEqual([]);
    });

    it('returns only the modules still marked isDraft: true', () => {
      writeModule('privacy.json', false);
      writeModule('terms.json', true);

      expect(findDraftFiles(tmpDir, ['privacy.json', 'terms.json'])).toEqual(['terms.json']);
    });
  });
});
