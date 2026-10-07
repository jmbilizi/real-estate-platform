/**
 * .NET Development Environment Setup Script
 *
 * This script sets up the .NET development environment for the Polyglot monorepo project.
 * It detects the operating system and performs the appropriate setup actions.
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const os = require('os');

// Process command line arguments
const args = process.argv.slice(2);
const installTools = args.includes('--install-tools');
const installNxPlugin = args.includes('--install-nx-plugin');

if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node dotnet-dev-setup.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --help, -h     Display this help message');
  console.log('  --install-tools  Install the .NET global tools');
  console.log('  --install-nx-plugin  Run pnpm add -D @nx/dotnet if the plugin is missing');
  console.log('');
  console.log('Description:');
  console.log(
    '  This script sets up the .NET development environment for the Polyglot monorepo project.',
  );
  console.log(
    '  It automatically detects the operating system and performs the appropriate setup actions.',
  );
  console.log('');
  console.log('Actions:');
  console.log(
    '  1. Checks for the .NET SDK (prints the download link if missing; never installs it)',
  );
  console.log(
    '  2. Sets PATH for this process only. It never writes the registry or a shell profile.',
  );
  console.log('  3. Installs .NET global tools (only with --install-tools)');
  console.log('  4. Checks the NX .NET plugin (installs it only with --install-nx-plugin)');
  process.exit(0);
}

// Configuration
const requiredDotNetMajor = '10'; // Required .NET SDK major version

// Determine if we're running on Windows
const isWindows = os.platform() === 'win32';

const sdkDownloadUrl = `https://dotnet.microsoft.com/download/dotnet/${requiredDotNetMajor}.0`;

/**
 * Put the .NET paths on PATH for this process, and on GITHUB_PATH when set (CI).
 * This function never writes the registry, a shell profile, or any other persistent setting.
 * It prints the entries for the developer to add by hand.
 */
function exportDotNetPaths() {
  const dotnetHome = path.join(os.homedir(), '.dotnet');
  const dotnetTools = path.join(dotnetHome, 'tools');
  process.env.PATH = [dotnetHome, dotnetTools, process.env.PATH].join(path.delimiter);
  if (process.env.GITHUB_PATH) {
    try {
      fs.appendFileSync(process.env.GITHUB_PATH, `${dotnetHome}\n${dotnetTools}\n`);
      console.log('✓ Added .NET paths to GITHUB_PATH.');
    } catch (e) {
      console.warn('Could not write GITHUB_PATH:', e.message);
    }
  }
  console.log('PATH is changed for this run only. To keep it, add these entries to your PATH:');
  console.log(`  ${dotnetHome}`);
  console.log(`  ${dotnetTools}`);
  if (isWindows) {
    console.log('Windows: Settings > "Edit environment variables for your account" > Path > New.');
  } else {
    console.log('Or add to ~/.profile: export PATH="$HOME/.dotnet:$HOME/.dotnet/tools:$PATH"');
  }
}

// Common .NET tools for code quality
const commonTools = [
  {
    name: 'dotnet-format',
    version: 'latest',
    description: 'Code formatter for .NET',
  },
  {
    name: 'dotnet-outdated-tool',
    version: 'latest',
    description: 'Find outdated NuGet packages',
  },
  {
    name: 'dotnet-cleanup',
    version: 'latest',
    description: 'Clean up project files',
  },
  {
    name: 'dotnet-doc',
    version: 'latest',
    description: 'Documentation generator',
  },
  {
    name: 'dotnet-coverage',
    version: 'latest',
    description: 'Code coverage tool',
  },
  {
    name: 'dotnet-reportgenerator-globaltool',
    version: 'latest',
    description: 'Generates HTML/Cobertura coverage reports from coverage.cobertura.xml',
  },
  { name: 'csharpier', version: 'latest', description: 'C# code formatter' },
  {
    name: 'roslynator.dotnet.cli',
    version: 'latest',
    description: 'Roslyn-based analyzers',
  },
];

// Utility functions
function executeCommand(command, silent = false) {
  try {
    const options = { stdio: silent ? 'pipe' : 'inherit' };
    return execSync(command, options);
  } catch (error) {
    if (!silent) {
      console.error(`Error executing command: ${command}`);
      console.error(error.message);
    }
    return null;
  }
}

function checkNxDotNetPluginInstalled() {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'),
    );
    return packageJson.devDependencies && packageJson.devDependencies['@nx/dotnet'];
  } catch {
    return false;
  }
}
// Functions for .NET tools installation
function installTool(tool) {
  console.log(`Installing ${tool.name}...`);
  const args = ['tool', 'install', '--global', tool.name];

  if (tool.version && tool.version !== 'latest') {
    args.push('--version', tool.version);
  }

  const result = spawnSync('dotnet', args, {
    encoding: 'utf8',
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    console.log(`Tool ${tool.name} may already be installed. Attempting to update...`);
    updateTool(tool);
  } else {
    console.log(`✓ Installed ${tool.name} successfully.`);
  }
}

function updateTool(tool) {
  console.log(`Updating ${tool.name}...`);
  const result = spawnSync('dotnet', ['tool', 'update', '--global', tool.name], {
    encoding: 'utf8',
    stdio: 'inherit',
  });

  if (result.status === 0) {
    console.log(`✓ Updated ${tool.name} successfully.`);
  } else {
    console.error(`✗ Failed to update ${tool.name}.`);
  }
}

function installDotNetTools() {
  console.log('\nSetting up .NET code quality tools...');

  // Install each tool
  for (const tool of commonTools) {
    installTool(tool);
  }

  console.log('\n✅ .NET code quality tools setup complete!');
  console.log('You can now use these tools in your .NET projects.');
}

// Main setup steps
async function setupDotNetEnvironment() {
  console.log('===== Setting up .NET development environment =====');

  // Step 1: Check for .NET SDK
  console.log('\nChecking for .NET SDK installation...');

  // Add diagnostic information to help troubleshoot
  console.log(`Operating System: ${os.platform()} (${os.release()})`);
  console.log(`Node.js Version: ${process.version}`);

  // Run dotnet --version directly for diagnostic purposes
  try {
    const dotnetVersionOutput = execSync('dotnet --version', { stdio: 'pipe' });
    console.log(`Direct dotnet --version output: ${dotnetVersionOutput.toString().trim()}`);

    // If we get here, .NET is definitely installed
    const dotnetVersion = dotnetVersionOutput.toString().trim();
    console.log(`Found .NET SDK version: ${dotnetVersion}`);

    // Check against required version - stricter check for major.minor version match
    const installedMajor = dotnetVersion.split('.')[0];

    if (installedMajor !== requiredDotNetMajor) {
      console.warn(
        `\nWARNING: Installed .NET SDK version (${dotnetVersion}) is not .NET ${requiredDotNetMajor}.x.`,
      );
      console.warn(`Install the .NET SDK ${requiredDotNetMajor}.0 yourself: ${sdkDownloadUrl}`);
    } else {
      console.log(`✓ .NET ${requiredDotNetMajor}.x SDK found (${dotnetVersion})`);
      exportDotNetPaths();
    }
  } catch (error) {
    console.error('ERROR: .NET SDK is not installed or not in PATH.');
    console.error(`Diagnostic information: ${error.message}`);

    // Try to get additional information about the environment
    console.log('\nEnvironment Path:');
    try {
      const pathVar = isWindows
        ? execSync('echo %PATH%', { stdio: 'pipe' }).toString()
        : execSync('echo $PATH', { stdio: 'pipe' }).toString();
      console.log(pathVar);
    } catch {
      console.log('Unable to display PATH variable');
    }

    // If on Windows, check for common installation locations
    let dotnetFoundButNotInPath = false;
    if (isWindows) {
      console.log('\nChecking common .NET SDK installation locations...');
      const commonPaths = [
        'C:\\Program Files\\dotnet\\dotnet.exe',
        'C:\\Program Files (x86)\\dotnet\\dotnet.exe',
      ];

      for (const dotnetPath of commonPaths) {
        try {
          if (fs.existsSync(dotnetPath)) {
            console.log(`Found .NET SDK at: ${dotnetPath}`);
            dotnetFoundButNotInPath = true;

            // Try to automatically add to PATH for current process
            const pathDir = path.dirname(dotnetPath);
            process.env.PATH = `${pathDir};${process.env.PATH}`;
            console.log('Added to PATH for current process. Trying again...');

            try {
              const retryVersion = execSync('dotnet --version', {
                stdio: 'pipe',
              })
                .toString()
                .trim();
              console.log(`Success! Found .NET SDK version: ${retryVersion}`);

              // Skip auto-install since we found it
              break;
            } catch {
              console.log('Still unable to run dotnet command. PATH update may require a restart.');
            }
          }
        } catch {
          // Ignore errors
        }
      }
    }

    if (!dotnetFoundButNotInPath) {
      console.log(`\nInstall the .NET SDK ${requiredDotNetMajor}.0 yourself: ${sdkDownloadUrl}`);
      process.exit(1);
    }
  }

  // Step 3: Check and install global tools if needed
  console.log('\nChecking for required .NET global tools...');

  if (!installTools) {
    console.log('Skipping .NET global tools installation (use --install-tools to install them).');
  } else {
    try {
      // Install .NET tools directly
      installDotNetTools();
    } catch (error) {
      console.warn('Warning: Error while setting up .NET global tools.');
      console.warn(`Error details: ${error.message}`);
    }
  }

  // Step 4: Check for NX .NET plugin
  console.log('\nChecking for @nx/dotnet NX plugin...');
  if (!checkNxDotNetPluginInstalled() && !installNxPlugin) {
    console.log('@nx/dotnet is missing. Run: pnpm add -D @nx/dotnet (or use --install-nx-plugin).');
  } else if (!checkNxDotNetPluginInstalled()) {
    console.log('Installing @nx/dotnet NX plugin...');
    try {
      executeCommand('pnpm add -D @nx/dotnet');
      console.log('@nx/dotnet NX plugin installed successfully');
    } catch (error) {
      console.error('Error installing @nx/dotnet plugin:');
      console.error(error.message);
      console.error('You may need to install it manually with: pnpm add -D @nx/dotnet');
    }
  } else {
    console.log('@nx/dotnet NX plugin is already installed.');
  }

  // Step 5: Provide usage instructions
  console.log('\n===== .NET development environment setup completed =====');
  console.log('\nYou can now create .NET projects using Nx generators:');
  console.log('  pnpm exec nx generate @nx/dotnet:app my-api --directory=apps');
  console.log('  pnpm exec nx generate @nx/dotnet:lib my-lib --directory=libs');
  console.log('\nProjects will be automatically tagged when you run:');
  console.log('  pnpm run nx:reset     # Triggers auto-tagging');
  console.log('  pnpm run nx:tag-projects  # Manual tagging if needed');
}

// Run the setup
setupDotNetEnvironment().catch((error) => {
  console.error('Error during setup:', error);
  process.exit(1);
});
