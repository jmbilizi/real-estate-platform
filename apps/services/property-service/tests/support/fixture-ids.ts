import type { ComplianceFixtureIds } from './fixtures';

/**
 * Reads the compliance fixture ids that `global-setup.ts` published into
 * `PROPERTY_SERVICE_E2E_FIXTURE_IDS` after `loadComplianceFixtures()` ran (see that file's own
 * header for why the value crosses the worker-process boundary via `process.env` and not
 * `globalThis`).
 *
 * ANTI-VACUITY, THE POINT OF THIS FILE: the seed dataset (`src/seed/mock-listings.ts`) has zero
 * suppressed addresses, zero suppressed listings, zero unapproved descriptions, zero non-consumer
 * statuses, zero `Land` rows and zero NULL beds/baths/sqft. Every compliance assertion this e2e
 * suite makes is therefore vacuously true against the seed alone — a suppressed-address test
 * "passes" trivially if there is no suppressed row to find, regardless of whether suppression
 * actually works. If this function returned a stub, or specs wrapped their assertions in
 * `describe.skip`/an `if (fixtures)` guard when the env var is absent, the suite would report green
 * while testing nothing — reproducing exactly the failure this module exists to catch, with extra
 * steps. So it THROWS instead of returning anything usable: loud failure over silent vacuity.
 *
 * This cannot break CI: `.github/workflows/ci.yml` wires only lint/test/build for property-service,
 * never `nx e2e` (verified by reading that workflow — there is no `nx e2e` invocation for this
 * project anywhere in it). This function can therefore only ever fail a deliberate, manual run of
 * the e2e suite — which is exactly when it should fail loudly if the fixtures were not loaded.
 */
export function complianceFixtureIds(): ComplianceFixtureIds {
  const raw = process.env.PROPERTY_SERVICE_E2E_FIXTURE_IDS;
  const command =
    'PROPERTY_SERVICE_E2E_FIXTURES=1 DATABASE_URL=<your disposable e2e database> ' +
    'pnpm exec nx e2e property-service';

  if (!raw) {
    throw new Error(
      'complianceFixtureIds: PROPERTY_SERVICE_E2E_FIXTURE_IDS is not set. This e2e suite requires ' +
        'the guarded compliance fixtures from tests/support/fixtures.ts, loaded by ' +
        'tests/support/global-setup.ts before the test workers start. That only happens when BOTH ' +
        'PROPERTY_SERVICE_E2E_FIXTURES=1 and DATABASE_URL are set for the process running `nx e2e` ' +
        `— run:\n  ${command}\n` +
        'Do not add a fallback or a skip here: the seed dataset alone makes every compliance ' +
        'assertion in this suite vacuously true, so a suite that tolerates missing fixtures is a ' +
        'suite that is not actually testing anything.',
    );
  }

  try {
    return JSON.parse(raw) as ComplianceFixtureIds;
  } catch (error) {
    throw new Error(
      'complianceFixtureIds: PROPERTY_SERVICE_E2E_FIXTURE_IDS is set but is not valid JSON ' +
        `(${(error as Error).message}). It is expected to be exactly what global-setup.ts got back ` +
        "from loadComplianceFixtures(), JSON.stringify()'d. Re-run the suite with both " +
        `PROPERTY_SERVICE_E2E_FIXTURES=1 and DATABASE_URL set:\n  ${command}\n` +
        'and check global-setup.ts if the value is still malformed after that.',
    );
  }
}
