export default {
  displayName: 'property-service',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  // Unit tests only. `tests/` holds the e2e suite, which requires the service to be
  // listening (see jest.e2e.config.ts); without this ignore it gets swept into
  // `nx test property-service` — and therefore into CI's nx:node-test — and fails with a
  // connection error that looks unrelated to whatever change triggered it.
  //
  // Note the absence of `<rootDir>`: Jest matches these against posix-normalized paths,
  // but `<rootDir>` interpolates the *native* path, so on Windows its backslashes are read
  // as regex escapes and the pattern silently never matches. Same trap applies to testMatch
  // globs. This is why the stock `/node_modules/` default is written without it.
  testPathIgnorePatterns: ['/node_modules/', '/tests/'],
  // `src/listings/listing-search-view.spec.ts` requires a migration to capture the SQL its `up()`
  // emits. Migrations are plain CommonJS `.js` and need no transform, but the `^.+\.[tj]s$`
  // transform above matches them and ts-jest then warns on every run that `allowJs` is off.
  // Skipping the transform for that directory is narrower than turning `allowJs` on repo-wide, and
  // the files run as-is because they were never TypeScript to begin with.
  //
  // Note the absence of `<rootDir>`, for the same Windows reason as testPathIgnorePatterns above.
  // The `/node_modules/` entry restates the Jest default, which is replaced rather than merged.
  transformIgnorePatterns: ['/node_modules/', '/migrations/'],
  coverageDirectory: '../../../coverage/apps/services/property-service',
};
