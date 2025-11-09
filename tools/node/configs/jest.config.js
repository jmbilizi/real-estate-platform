/**
 * Centralized Jest configuration for Node.js projects
 *
 * This configuration is designed to be extended by Node.js projects in the monorepo.
 * It provides consistent testing setup across all JavaScript/TypeScript projects.
 */

module.exports = {
  // Display test results with colors in terminal
  verbose: true,

  // Automatically clear mock calls and instances between every test
  clearMocks: true,

  // Generate coverage reports
  collectCoverage: true,

  // Directory where Jest should output its coverage files
  coverageDirectory: "coverage",

  // Coverage providers to use
  coverageProvider: "v8",

  // File extensions Jest will look for
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],

  // A list of paths to directories that Jest should use to search for files in
  roots: ["<rootDir>/src"],

  // The test environment to use
  testEnvironment: "node",

  // The glob patterns Jest uses to detect test files
  testMatch: ["**/__tests__/**/*.[jt]s?(x)", "**/?(*.)+(spec|test).[tj]s?(x)"],

  // Transform files with ts-jest for TypeScript processing
  transform: {
    "^.+\\.(ts|tsx)$": "ts-jest",
  },

  // Generate test reports in junit format for CI/CD integration
  reporters: [
    "default",
    [
      "jest-junit",
      {
        outputDirectory: "test-results",
        outputName: "jest-junit.xml",
      },
    ],
  ],

  // Configuration for collecting code coverage information
  coverageReporters: ["text", "lcov", "clover", "html"],

  // Fail if coverage is below specified thresholds
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },

  // Makes the test run faster by limiting number of workers to CPU cores-1
  maxWorkers: "50%",
};
