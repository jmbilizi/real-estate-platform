/**
 * @file Centralized ESLint configuration for Node.js projects
 *
 * This configuration is designed to be extended by Node.js projects in the monorepo.
 * It provides consistent linting rules across all JavaScript/TypeScript projects.
 */

// For ESLint v9 flat config
module.exports = [
  {
    // Base eslint config
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parser: require("@typescript-eslint/parser"),
      parserOptions: {
        project: null, // Set to null to avoid requiring tsconfig.json
      },
    },
    plugins: {
      "@typescript-eslint": require("@typescript-eslint/eslint-plugin"),
    },
    rules: {
      // Error prevention
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
      "no-return-await": "error",
      "no-unused-vars": "off", // Disabled in favor of @typescript-eslint/no-unused-vars
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "no-var": "error",
      "prefer-const": "error",

      // Code style
      quotes: ["error", "single", { avoidEscape: true }],
      semi: ["error", "always"],
      "comma-dangle": ["error", "always-multiline"],
      "arrow-parens": ["error", "always"],

      // TypeScript specific
      "@typescript-eslint/explicit-function-return-type": [
        "warn",
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-non-null-assertion": "warn",

      // Import ordering
      "sort-imports": [
        "error",
        {
          ignoreCase: true,
          ignoreDeclarationSort: true,
        },
      ],
    },
  },
  {
    // Test files
    files: ["**/*.spec.ts", "**/*.test.ts", "**/__tests__/**/*.ts"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  // JavaScript files (non-TypeScript)
  {
    files: ["**/*.js"],
    rules: {
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-var-requires": "off",
    },
  },
  // CLI scripts
  {
    files: ["**/scripts/**/*.js"],
    rules: {
      "no-console": "off", // Allow console.log in script files
    },
  },
  {
    ignores: ["node_modules/", "dist/", "**/*.d.ts", "coverage/"],
  },
];
