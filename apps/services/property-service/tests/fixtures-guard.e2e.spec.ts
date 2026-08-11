/**
 * Tests ONLY the opt-in/production guard exported from `tests/support/fixtures.ts`. This spec must
 * never require a database or a running service — `assertFixturesEnabled()` is a pure environment
 * check, and asserting that in isolation is the whole point: the other two guards (location,
 * self-labelling shape) can't be exercised without a real database, but this one can be, cheaply and
 * deterministically, every time this file runs.
 *
 * Filed under `tests/` (not `src/`) to match where `fixtures.ts` itself lives, and named
 * `*.e2e.spec.ts` per this ticket's instructions, so it is swept up by `nx e2e` alongside the rest of
 * the e2e suite. It does not need `nx e2e`'s server boot for its own assertions, though.
 */
import { assertFixturesEnabled } from './support/fixtures';

describe('assertFixturesEnabled', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('throws when PROPERTY_SERVICE_E2E_FIXTURES is unset', () => {
    delete process.env.PROPERTY_SERVICE_E2E_FIXTURES;
    delete process.env.NODE_ENV;

    expect(() => assertFixturesEnabled()).toThrow(/PROPERTY_SERVICE_E2E_FIXTURES/);
  });

  it('throws when PROPERTY_SERVICE_E2E_FIXTURES is set to something other than "1"', () => {
    process.env.PROPERTY_SERVICE_E2E_FIXTURES = 'true';
    delete process.env.NODE_ENV;

    expect(() => assertFixturesEnabled()).toThrow(/PROPERTY_SERVICE_E2E_FIXTURES/);
  });

  it('does not throw when the flag is "1" and NODE_ENV is not production', () => {
    process.env.PROPERTY_SERVICE_E2E_FIXTURES = '1';
    process.env.NODE_ENV = 'test';

    expect(() => assertFixturesEnabled()).not.toThrow();
  });

  it('throws when NODE_ENV=production, even with the opt-in flag set to "1"', () => {
    process.env.PROPERTY_SERVICE_E2E_FIXTURES = '1';
    process.env.NODE_ENV = 'production';

    expect(() => assertFixturesEnabled()).toThrow(/production/);
  });
});
