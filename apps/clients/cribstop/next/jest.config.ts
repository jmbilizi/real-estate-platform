export default {
  displayName: 'cribstop-next',
  preset: '../../../../jest.preset.js',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
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
  coverageDirectory: '../../../../coverage/apps/clients/cribstop/next',
};
