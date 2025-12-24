/**
 * Node.js Configuration Applier
 *
 * This script applies the centralized configuration files to a Node.js project.
 * It's designed to be run after a new Node.js project is created.
 */

const fs = require("fs");
const path = require("path");

// Root path
const rootDir = process.cwd();
const configsDir = path.join(rootDir, "tools", "node", "configs");

/**
 * Create a file that extends a centralized configuration
 * @param {string} projectPath - Path to the project
 * @param {string} fileName - Name of the file to create
 * @param {string} extendsPath - Path to the centralized configuration
 * @param {string} configType - Type of configuration (for logging)
 */
function createConfigFile(projectPath, fileName, extendsPath, configType) {
  const filePath = path.join(projectPath, fileName);

  // Skip if file already exists
  if (fs.existsSync(filePath)) {
    console.log(`${configType} configuration already exists at: ${filePath}`);
    return;
  }

  let content = "";

  if (fileName.endsWith(".json")) {
    // JSON files (like tsconfig.json)
    content = JSON.stringify(
      {
        extends: extendsPath,
      },
      null,
      2,
    );
  } else if (fileName === ".eslintrc.js") {
    // ESLint config
    content = `module.exports = {
  extends: '${extendsPath}',
  root: true,
  parserOptions: {
    tsconfigRootDir: __dirname,
  },
};`;
  } else if (fileName === ".prettierrc.js") {
    // Prettier config
    content = `module.exports = {
  ...require('${extendsPath}'),
};`;
  } else if (fileName === "jest.config.js") {
    // Jest config
    content = `module.exports = {
  ...require('${extendsPath}'),
  displayName: '${path.basename(projectPath)}',
  preset: '${path.relative(projectPath, path.join(rootDir, "jest.preset.js"))}',
  transform: {
    '^.+\\\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '${path.relative(projectPath, path.join(rootDir, "coverage", path.basename(projectPath)))}',
};`;
  }

  fs.writeFileSync(filePath, content);
  console.log(`Created ${configType} configuration at: ${filePath}`);
}

/**
 * Apply centralized configurations to a project
 * @param {string} projectPath - Path to the project
 */
function applyConfigurations(projectPath) {
  if (!fs.existsSync(projectPath)) {
    console.error(`Project path does not exist: ${projectPath}`);
    process.exit(1);
  }

  console.log(`Applying centralized configurations to: ${projectPath}`);

  // Check if it's a library or application based on project.json
  const projectJsonPath = path.join(projectPath, "project.json");
  let isLibrary = false;

  if (fs.existsSync(projectJsonPath)) {
    const projectJson = require(projectJsonPath);
    isLibrary = projectJson.projectType === "library";
  }

  // ESLint
  const eslintConfigPath = path.relative(projectPath, path.join(configsDir, "eslint-config.js"));
  createConfigFile(projectPath, ".eslintrc.js", eslintConfigPath, "ESLint");

  // Prettier
  const prettierConfigPath = path.relative(projectPath, path.join(configsDir, "prettier-config.js"));
  createConfigFile(projectPath, ".prettierrc.js", prettierConfigPath, "Prettier");

  // TypeScript
  const tsConfigPath = path.relative(
    projectPath,
    path.join(configsDir, isLibrary ? "tsconfig.lib.json" : "tsconfig.app.json"),
  );
  createConfigFile(projectPath, "tsconfig.json", tsConfigPath, "TypeScript");

  // Jest
  const jestConfigPath = path.relative(projectPath, path.join(configsDir, "jest.config.js"));
  createConfigFile(projectPath, "jest.config.js", jestConfigPath, "Jest");

  console.log(`\nConfiguration complete for: ${projectPath}`);
}

// Main function
function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("No project path provided.");
    console.log("Usage: node apply-node-configs.js <project-path>");
    process.exit(1);
  }

  const projectPath = args[0];
  applyConfigurations(projectPath);
}

// Run the script if executed directly
if (require.main === module) {
  main();
}

module.exports = {
  applyConfigurations,
};
