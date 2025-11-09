#!/usr/bin/env node

/**
 * DEPRECATED: This script is deprecated in favor of the unified hooks system.
 * Please use 'npm run setup-hooks' instead.
 *
 * Setup hooks wrapper script
 * Detects OS and runs the appropriate script
 */

console.warn("WARNING: This Python-specific hooks setup script is deprecated.");
console.warn(
  "Please use the unified hooks system instead: npm run setup-hooks",
);
console.warn("See documentation at: ./tools/hooks/docs/README.md");

process.exit(0);

// Execute the script
const result = spawnSync(
  isWindows ? scriptPath : "bash",
  isWindows ? [] : [scriptPath],
  {
    stdio: "inherit",
    shell: true,
  },
);

// Exit with the same status code
process.exit(result.status);
