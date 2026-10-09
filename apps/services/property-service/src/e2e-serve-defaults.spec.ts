import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { introspectionStubPort } from '../tests/support/introspection-stub';

/** Every `ACCOUNT_SERVICE_*_URL` variable the app reads must default to the e2e stub (#745). */
function urlVariablesRead(dir: string): string[] {
  const found = new Set<string>();
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      urlVariablesRead(path).forEach((variable) => found.add(variable));
    } else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) {
      const source = readFileSync(path, 'utf8');
      for (const match of source.matchAll(/process\.env\.(ACCOUNT_SERVICE_\w*_URL)\b/g)) {
        found.add(match[1] as string);
      }
    }
  }
  return [...found];
}

describe('e2e serve defaults', () => {
  const variables = urlVariablesRead(__dirname);

  it('finds the account-service URLs the app reads', () => {
    expect(variables).toEqual(
      expect.arrayContaining(['ACCOUNT_SERVICE_INTROSPECT_URL', 'ACCOUNT_SERVICE_CONTACTS_URL']),
    );
  });

  it('points every one of them at the introspection stub', () => {
    const saved = { ...process.env };
    try {
      for (const variable of variables) delete process.env[variable];
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../tests/support/e2e-serve-defaults.js');
      });
      for (const variable of variables) {
        const url = new URL(process.env[variable] ?? 'invalid');
        expect({ variable, host: url.hostname, port: url.port }).toEqual({
          variable,
          host: 'localhost',
          port: String(introspectionStubPort()),
        });
      }
    } finally {
      process.env = saved;
    }
  });
});
