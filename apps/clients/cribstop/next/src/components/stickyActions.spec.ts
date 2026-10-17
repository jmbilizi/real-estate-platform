import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * A fixed bar at the bottom of a phone screen sits under the tab bar unless it clears
 * `--tab-bar-h` (#943). This guard reads every component for a fixed, bottom-anchored bar and
 * fails when one pins to `bottom-0`. The tab bar itself is the only exception. Dialogs cover the
 * tab bar. The sticky listing CTA renders only where the tab bar is absent.
 */
const ROOT = __dirname;
const ALLOWED = ['MobileTabBar.tsx'];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.tsx$/.test(name) && !/\.spec\./.test(name) ? [p] : [];
  });
}

describe('fixed bottom actions', () => {
  it('clear the tab bar through --tab-bar-h', () => {
    const offenders = files(ROOT).flatMap((f) =>
      ALLOWED.some((a) => f.endsWith(a))
        ? []
        : readFileSync(f, 'utf8')
            .split('\n')
            .filter((l) => /className/.test(l) && /\bfixed\b/.test(l) && /\bbottom-0\b/.test(l))
            .map((l) => `${f}: ${l.trim()}`),
    );
    expect(offenders).toEqual([]);
  });

  it.each(['agent/AgentLeadDetail.tsx', 'staff/LeadDetail.tsx'])(
    '%s lifts its action bar above the tab bar',
    (file) => {
      expect(readFileSync(join(ROOT, file), 'utf8')).toContain('bottom-[var(--tab-bar-h)]');
    },
  );
});
