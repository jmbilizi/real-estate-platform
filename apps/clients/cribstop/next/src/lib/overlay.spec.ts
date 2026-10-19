/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '..');

/** Files with a `fixed inset-0` layer that is not an overlay surface. */
const NOT_AN_OVERLAY = new Set([
  // Transparent click catcher behind the open header search. It holds no content.
  'components/NavBar.tsx',
]);

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx$/.test(entry.name) && !/\.spec\.tsx$/.test(entry.name) ? [full] : [];
  });
}

describe('overlay registry', () => {
  const files = sourceFiles(SRC).map((f) => ({
    rel: path.relative(SRC, f).replace(/\\/g, '/'),
    text: fs.readFileSync(f, 'utf8'),
  }));
  const overlays = files.filter((f) => /fixed inset-0/.test(f.text) && !NOT_AN_OVERLAY.has(f.rel));

  it('finds the overlays it is meant to guard', () => {
    expect(overlays.map((f) => f.rel)).toEqual(
      expect.arrayContaining(['components/Modal.tsx', 'components/CompactSearchBar.tsx']),
    );
  });

  it('registers every fixed inset-0 component through useOverlayOpen', () => {
    const missing = overlays.filter((f) => !/useOverlayOpen\(/.test(f.text)).map((f) => f.rel);
    expect(missing).toEqual([]);
  });

  it('gives every fixed inset-0 overlay a modal dialog role', () => {
    const missing = overlays
      .filter((f) => !/role="dialog"/.test(f.text) || !/aria-modal="true"/.test(f.text))
      .map((f) => f.rel);
    expect(missing).toEqual([]);
  });

  it('hides the tab bar on the registry attribute and no other detection', () => {
    const css = fs.readFileSync(path.join(SRC, 'app/globals.css'), 'utf8');
    expect(css).toMatch(/html\[data-overlay-open\] \.mobile-tab-bar/);
    expect(css).not.toContain('data-scroll-lock');
  });
});
