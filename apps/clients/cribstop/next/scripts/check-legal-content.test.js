const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findDraftFiles } = require('./check-legal-content');

const SCRIPT_PATH = path.join(__dirname, 'check-legal-content.js');

/**
 * Runs as a child process, not a `require`, because the script's failure path is
 * `process.exit(1)` — asserting on a real exit code is what proves the build actually stops.
 * `env` lets each test control the production-build signal without touching the real process.
 */
function runGate(env) {
  return execFileSync(process.execPath, [SCRIPT_PATH], {
    encoding: 'utf8',
    env: { ...process.env, CI: '', NEXT_BUILD_STANDALONE: '', ...env },
  });
}

describe('check-legal-content.js', () => {
  describe('production build (CI=true)', () => {
    it('fails while a legal content module is a draft placeholder (current state, pending #156)', () => {
      expect(() => runGate({ CI: 'true' })).toThrow(/Command failed/);
    });

    it('reports both content modules by name when both are drafts', () => {
      try {
        runGate({ CI: 'true' });
        throw new Error('expected the gate script to exit non-zero');
      } catch (error) {
        const output = error.stderr ?? '';
        expect(output).toMatch(/privacy\.json/);
        expect(output).toMatch(/terms\.json/);
      }
    });
  });

  describe('production build (NEXT_BUILD_STANDALONE=1, the Docker build signal)', () => {
    it('fails the same way as the CI signal', () => {
      expect(() => runGate({ NEXT_BUILD_STANDALONE: '1' })).toThrow(/Command failed/);
    });
  });

  describe('non-production build (neither signal set, e.g. a local `nx build`)', () => {
    it('does not fail, even with a draft module present', () => {
      expect(runGate({})).toBe('');
    });
  });

  /**
   * Exercises `findDraftFiles` against fixture modules, not the real content, so the pass case
   * stays covered after #156 sets the real `isDraft` values to false and the tests above are
   * rewritten for the approved-copy state.
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
