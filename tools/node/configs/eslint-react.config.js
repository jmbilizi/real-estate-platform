/**
 * @file Centralized ESLint configuration for React/React Native projects
 *
 * Extends the base Node.js config with React and React Hooks rules.
 * Used by all client-side projects (Next.js, Expo, shared libs).
 *
 * Usage in per-project eslint.config.js:
 *   const reactConfig = require('../../tools/node/configs/eslint-react.config.js');
 *   module.exports = [...reactConfig];
 */

const baseConfig = require('./eslint.config.js');
const reactPlugin = require('eslint-plugin-react');
const reactHooksPlugin = require('eslint-plugin-react-hooks');
const eslintConfigPrettier = require('eslint-config-prettier');

module.exports = [
  ...baseConfig,
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      // --- React ---
      'react/react-in-jsx-scope': 'off', // Not needed with new JSX transform
      'react/prop-types': 'off', // Using TypeScript for prop validation
      'react/no-unescaped-entities': 'warn',
      'react/jsx-no-target-blank': 'error',
      'react/self-closing-comp': 'warn',
      'react/jsx-curly-brace-presence': ['warn', { props: 'never', children: 'never' }],
      'react/jsx-boolean-value': ['warn', 'never'],
      'react/jsx-no-duplicate-props': 'error',
      'react/jsx-no-undef': 'error',
      'react/no-children-prop': 'error',
      'react/no-danger-with-children': 'error',

      // --- React Hooks ---
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // --- Relax base rules for React/UI code ---
      '@typescript-eslint/explicit-function-return-type': 'off', // Components use JSX return inference
    },
    settings: {
      react: { version: 'detect' },
    },
  },
  // Prettier must be LAST — disables formatting rules that conflict with Prettier
  eslintConfigPrettier,
];
