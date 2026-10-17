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
    files: ['**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parser: require('@typescript-eslint/parser'),
      parserOptions: {
        project: null, // Set to null to avoid requiring tsconfig.json
      },
    },
    plugins: {
      '@next/next': require('@next/eslint-plugin-next'),
      '@typescript-eslint': require('@typescript-eslint/eslint-plugin'),
      'react-hooks': require('eslint-plugin-react-hooks'),
    },
    rules: {
      // Error prevention
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      'no-return-await': 'error',
      'no-unused-vars': 'off', // Disabled in favor of @typescript-eslint/no-unused-vars
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      'no-var': 'error',
      'prefer-const': 'error',

      // Code style
      quotes: ['error', 'single', { avoidEscape: true }],
      semi: ['error', 'always'],
      'comma-dangle': ['error', 'always-multiline'],
      'arrow-parens': ['error', 'always'],

      // TypeScript specific
      '@typescript-eslint/explicit-function-return-type': [
        'warn',
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',

      // Import ordering
      'sort-imports': [
        'error',
        {
          ignoreCase: true,
          ignoreDeclarationSort: true,
        },
      ],
    },
  },
  {
    // Test files
    files: ['**/*.spec.ts', '**/*.test.ts', '**/__tests__/**/*.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  // JavaScript files (non-TypeScript)
  {
    files: ['**/*.js'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-var-requires': 'off',
    },
  },
  // CLI scripts
  {
    files: ['**/scripts/**/*.js'],
    rules: {
      'no-console': 'off', // Allow console.log in script files
    },
  },
  {
    // Imported app baseline: keep hard errors, suppress warning-only strict typing rules.
    files: ['apps/clients/cribstop/**/*.{ts,tsx,js,jsx}'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // Web app only: the Query lint rules need `@tanstack/react-query` in scope.
    files: ['apps/clients/cribstop/**/*.{ts,tsx}'],
    plugins: { '@tanstack/query': require('@tanstack/eslint-plugin-query') },
    rules: require('@tanstack/eslint-plugin-query').configs['flat/recommended'][0].rules,
  },
  {
    ignores: ['node_modules/', 'dist/', '**/.next/**', '**/*.d.ts', 'coverage/'],
  },
];
