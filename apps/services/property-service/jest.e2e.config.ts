/**
 * The e2e suite for this service. Kept in the service's own project rather than a generated
 * `property-service-e2e` sibling, matching how every other service in this repo holds its tests
 * (`account-service/Tests/`, `multi-model-inference/tests/`).
 *
 * Driven by the `e2e` target, which boots the service first — never by `nx test`, which uses
 * jest.config.ts and ignores `tests/`.
 */
export default {
  displayName: 'property-service-e2e',
  preset: '../../../jest.preset.js',
  rootDir: '.',
  // Relative glob, not `<rootDir>/...`: on Windows `<rootDir>` interpolates a backslash
  // path that micromatch reads as escape sequences, so the pattern matches nothing.
  testMatch: ['**/tests/**/*.e2e.spec.ts'],
  globalSetup: '<rootDir>/tests/support/global-setup.ts',
  globalTeardown: '<rootDir>/tests/support/global-teardown.ts',
  setupFiles: ['<rootDir>/tests/support/test-setup.ts'],
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
      },
    ],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../../coverage/apps/services/property-service-e2e',
};
