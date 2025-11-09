/**
 * Centralized Prettier configuration for Node.js projects
 *
 * This configuration is designed to be extended by Node.js projects in the monorepo.
 * It provides consistent code formatting across all JavaScript/TypeScript projects.
 */

module.exports = {
  // Line length - keep it reasonable for readability
  printWidth: 100,

  // Use single quotes instead of double quotes
  singleQuote: true,

  // Always add trailing commas in multiline (helps with git diffs)
  trailingComma: "all",

  // Add spaces between brackets in object literals
  bracketSpacing: true,

  // Put the > of a multi-line HTML/JSX element at the end of the last line
  bracketSameLine: false,

  // Include parentheses around a sole arrow function parameter
  arrowParens: "always",

  // Use tabs instead of spaces
  useTabs: false,

  // Number of spaces per indentation level
  tabWidth: 2,

  // Add semicolons at the end of statements
  semi: true,

  // End of line character
  endOfLine: "lf",

  // Enforce consistent quote style in JSX
  jsxSingleQuote: false,

  // Configure Prettier to correctly handle different file types
  overrides: [
    {
      files: ["*.json", "*.yaml", "*.yml"],
      options: {
        singleQuote: false,
      },
    },
    {
      files: ["*.md"],
      options: {
        proseWrap: "always",
      },
    },
  ],
};
