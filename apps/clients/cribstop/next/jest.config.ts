export default {
  displayName: 'cribstop-web',
  preset: '../../../../jest.preset.js',
  testEnvironment: 'jsdom',
  // #940. Clock guard: TEST_CLOCK_OFFSET_DAYS moves the system clock ahead.
  setupFiles: ['../../../../tools/node/configs/jest-clock-offset.js'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  // #868. Safety margin for the parallel run. Do not raise it above 10 s. A slow spec needs a
  // cheaper render, not a longer limit.
  testTimeout: 10000,
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // Leaflet ships CSS that Jest cannot parse, and the map is always loaded through
    // `next/dynamic({ ssr: false })` anyway — no test renders it for real.
    '\\.(css|scss)$': '<rootDir>/src/test/style-stub.ts',
  },
  // Deliberately no `<rootDir>` in these two: Jest matches them against posix-normalized
  // paths but interpolates `<rootDir>` as the *native* path, so on Windows the backslashes
  // are read as regex escapes and the pattern silently matches nothing. Same trap as
  // property-service/jest.config.ts.
  testPathIgnorePatterns: ['/node_modules/', '/.next/'],
  // TanStack Pacer and its store ship ESM only. Transform them so Jest can load them.
  transformIgnorePatterns: [
    '/node_modules/(?!.pnpm|@tanstack/(react-pacer|pacer|react-store|store))',
  ],
  coverageDirectory: '../../../../coverage/apps/clients/cribstop/next',
};
