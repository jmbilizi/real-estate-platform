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
const skipTools = args.includes('--skip-tools');

if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node dotnet-dev-setup.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --help, -h     Display this help message');
  console.log('  --skip-tools   Skip installation of .NET global tools');
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
  console.log('  1. Checks for .NET SDK installation');
  console.log('  2. Verifies .NET SDK version');
  console.log('  3. Installs required .NET global tools (unless --skip-tools is used)');
  console.log('  4. Ensures NX .NET plugin is installed');
  process.exit(0);
}

// Configuration
const requiredDotNetMajor = '10'; // Required .NET SDK major version

// Determine if we're running on Windows
const isWindows = os.platform() === 'win32';
const isUnix = !isWindows;

/**
 * Automatically writes PATH entries to the user's shell profile if not already present.
 * Handles ~/.zshrc (zsh), ~/.bashrc and ~/.bash_profile (bash) on macOS/Linux.
 * On Windows, uses setx to persist the PATH change.
 */
function persistDotNetPaths() {
  if (isWindows) {
    try {
      const dotnetHome = path.join(os.homedir(), '.dotnet');
      const dotnetTools = path.join(dotnetHome, 'tools');
      // Use PowerShell to safely read and update the user PATH via registry (avoids setx truncation and %PATH% expansion issues)
      const ps = `
        $current = [Environment]::GetEnvironmentVariable('PATH', 'User');
        $entries = @('${dotnetHome.replace(/\\/g, '\\\\')}', '${dotnetTools.replace(/\\/g, '\\\\')}');
        foreach ($e in $entries) {
          if ($current -notlike "*$e*") { $current = "$e;$current" }
        }
        [Environment]::SetEnvironmentVariable('PATH', $current, 'User');
      `.trim();
      execSync(`powershell -NoProfile -NonInteractive -Command "${ps}"`, { stdio: 'pipe' });
      console.log('✓ Added .NET paths to Windows user PATH (restart terminal to apply).');
    } catch (e) {
      console.warn('Could not update Windows PATH automatically:', e.message);
    }
    return;
  }

  const home = os.homedir();
  const triggerFile = path.join(home, '.dotnet-env-refresh');
  const shell = process.env.SHELL || '';
  const isZsh = shell.includes('zsh');

  // Profiles to update
  const profiles = isZsh
    ? [path.join(home, '.zshrc'), path.join(home, '.zprofile')]
    : [path.join(home, '.bashrc'), path.join(home, '.bash_profile')];

  const pathMarker = '# Added by dotnet:env setup';
  const pathBlock = `\n${pathMarker}\nexport PATH="$HOME/.dotnet:$HOME/.dotnet/tools:$PATH"\n`;

  // Auto-refresh hook: sources the profile when trigger file exists.
  // Fires automatically at the next shell prompt after `pnpm run dotnet:env` returns,
  // so `dotnet` becomes available without closing the terminal.
  const hookMarker = '# dotnet:env auto-refresh hook';
  const zshHook = `
${hookMarker}
_dotnet_env_refresh() {
  local trigger="$HOME/.dotnet-env-refresh"
  if [ -f "$trigger" ]; then
    rm -f "$trigger"
    source "$HOME/.zshrc"
  fi
}
precmd_functions+=(_dotnet_env_refresh)
`;
  const bashHook = `
${hookMarker}
_dotnet_env_refresh() {
  local trigger="$HOME/.dotnet-env-refresh"
  if [ -f "$trigger" ]; then
    rm -f "$trigger"
    source "$HOME/.bashrc"
  fi
}
PROMPT_COMMAND="_dotnet_env_refresh\${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
`;
  const hook = isZsh ? zshHook : bashHook;

  // Write PATH exports and auto-refresh hook to shell profiles
  for (const profile of profiles) {
    try {
      const existing = fs.existsSync(profile) ? fs.readFileSync(profile, 'utf-8') : '';
      let content = existing;
      let changed = false;

      if (!existing.includes(pathMarker)) {
        content += pathBlock;
        changed = true;
        console.log(`✓ Added .NET PATH entries to ${profile}`);
      } else {
        console.log(`✓ PATH already configured in ${profile}`);
      }

      if (!existing.includes(hookMarker)) {
        content += hook;
        changed = true;
        console.log(`✓ Added auto-refresh hook to ${profile}`);
      }

      if (changed) {
        fs.writeFileSync(profile, content, 'utf-8');
      }
    } catch (e) {
      console.warn(`Could not update ${profile}:`, e.message);
    }
  }

  // Write the trigger file — the hook above will detect it on the next prompt
  // and source the profile, making `dotnet` available immediately without
  // closing the terminal.
  try {
    fs.writeFileSync(triggerFile, '', 'utf-8');
    console.log('✓ Terminal PATH will refresh automatically at the next prompt.');
  } catch (e) {
    console.warn('Could not write refresh trigger:', e.message);
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

// Set this to true if you want to allow automatic installation of .NET SDK
const AUTO_INSTALL_ENABLED = true; // Can be controlled via environment variable

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
  } catch (error) {
    return false;
  }
}

function downloadFile(url, destinationPath) {
  console.log(`Downloading from ${url} to ${destinationPath}...`);
  try {
    // Use PowerShell to download the file on Windows
    if (isWindows) {
      const powershellCommand = `
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12;
        Invoke-WebRequest -Uri "${url}" -OutFile "${destinationPath}"
      `;
      execSync(`powershell -Command "${powershellCommand}"`, {
        stdio: 'inherit',
      });
      return true;
    } else {
      // For Unix systems use curl or wget
      const curlCommand = `curl -L "${url}" -o "${destinationPath}"`;
      execSync(curlCommand, { stdio: 'inherit' });
      return true;
    }
  } catch (error) {
    console.error(`Failed to download file: ${error.message}`);
    return false;
  }
}

function installDotNetSdk() {
  console.log('\nAttempting to automatically install .NET SDK...');

  // Creating a temporary directory for the installer
  const tempDir = path.join(os.tmpdir(), 'dotnet-installer');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // Determine the correct installer URL based on OS
  let installerPath;
  // Use the official dotnet-install script which always fetches the latest patch for the channel
  const channel = `${requiredDotNetMajor}.0`;

  if (isWindows) {
    installerPath = path.join(tempDir, 'dotnet-install.ps1');
    const downloaded = downloadFile('https://dot.net/v1/dotnet-install.ps1', installerPath);
    if (!downloaded) return false;
    try {
      execSync(
        `powershell -ExecutionPolicy Bypass -File "${installerPath}" -Channel ${channel} -InstallDir "$env:ProgramFiles\\dotnet"`,
        { stdio: 'inherit' },
      );
    } catch (error) {
      console.error(`Installation failed: ${error.message}`);
      return false;
    }
  } else if (os.platform() === 'darwin' || os.platform() === 'linux') {
    installerPath = path.join(tempDir, 'dotnet-install.sh');
    const downloaded = downloadFile('https://dot.net/v1/dotnet-install.sh', installerPath);
    if (!downloaded) return false;
    try {
      execSync(`bash "${installerPath}" --channel ${channel}`, { stdio: 'inherit' });
    } catch (error) {
      console.error(`Installation failed: ${error.message}`);
      return false;
    }
  } else {
    console.log('Automatic installation is not supported on this platform.');
    console.log(
      `Please install .NET ${requiredDotNetMajor} SDK manually: https://dotnet.microsoft.com/download/dotnet/${channel}`,
    );
    return false;
  }

  // Clean up installer script
  try {
    fs.unlinkSync(installerPath);
  } catch (error) {
    // Ignore cleanup errors
  }

  console.log(`.NET ${requiredDotNetMajor} SDK installation completed.`);
  return true;
}

// Function to list installed .NET SDKs
function listInstalledDotNetSdks() {
  try {
    console.log('\nChecking installed .NET SDKs...');
    const output = executeCommand('dotnet --list-sdks', true);
    if (output) {
      const sdks = output.toString().trim().split('\n');
      if (sdks.length > 0 && sdks[0] !== '') {
        console.log('Installed .NET SDKs:');
        sdks.forEach((sdk) => console.log(`  ${sdk}`));
        return sdks.map((sdk) => sdk.split(' ')[0].trim()); // Extract just the version numbers
      }
    }
    return [];
  } catch (error) {
    return [];
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

      if (AUTO_INSTALL_ENABLED) {
        console.log(`\nAttempting to install latest .NET ${requiredDotNetMajor} SDK...`);
        const installSuccess = installDotNetSdk();

        if (!installSuccess) {
          console.warn('Failed to automatically install the required SDK version.');
          console.warn(
            'Continuing with the current version, but you may encounter compatibility issues.',
          );
        } else {
          try {
            const newVersion = execSync('dotnet --version', { stdio: 'pipe' }).toString().trim();
            console.log(`Now using .NET SDK version: ${newVersion}`);
          } catch (e) {
            // Ignore errors
          }
        }
      } else {
        console.warn(
          `Please install .NET ${requiredDotNetMajor} SDK: https://dotnet.microsoft.com/download/dotnet/${requiredDotNetMajor}.0`,
        );
      }
    } else {
      console.log(`✓ .NET ${requiredDotNetMajor}.x SDK found (${dotnetVersion})`);
      // Ensure PATH is persisted and refresh hook is in place for the current terminal
      persistDotNetPaths();
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
    } catch (e) {
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
            } catch (retryError) {
              console.log('Still unable to run dotnet command. PATH update may require a restart.');
            }
          }
        } catch (e) {
          // Ignore errors
        }
      }
    }

    if (AUTO_INSTALL_ENABLED && !dotnetFoundButNotInPath) {
      // Attempt automatic installation
      const installSuccess = installDotNetSdk();

      if (installSuccess) {
        // After install, dotnet lands in ~/.dotnet — add it to PATH for this process
        const dotnetHome = path.join(os.homedir(), '.dotnet');
        if (fs.existsSync(dotnetHome)) {
          process.env.PATH = `${dotnetHome}${isWindows ? ';' : ':'}${process.env.PATH}`;
          console.log(`\nAdded ${dotnetHome} to PATH for this session.`);
        }

        // Check if installation succeeded by trying to run dotnet again
        try {
          const installedVersion = execSync('dotnet --version', {
            stdio: 'pipe',
            env: process.env,
          })
            .toString()
            .trim();
          console.log(`\nSuccessfully installed .NET SDK version: ${installedVersion}`);

          // Automatically persist PATH to shell profile
          persistDotNetPaths();

          // List all installed SDKs
          listInstalledDotNetSdks();

          // Continue with the script since we now have .NET installed
        } catch (postInstallError) {
          // Try adding ~/.dotnet to PATH and retry once more
          const dotnetHome = path.join(os.homedir(), '.dotnet');
          process.env.PATH = `${dotnetHome}${isWindows ? ';' : ':'}${process.env.PATH}`;
          try {
            const retryVersion = execSync('dotnet --version', { stdio: 'pipe', env: process.env })
              .toString()
              .trim();
            console.log(`\nSuccessfully installed .NET SDK version: ${retryVersion}`);

            // Automatically persist PATH to shell profile
            persistDotNetPaths();
          } catch {
            console.error(
              'Installation appeared to succeed, but dotnet command still not available.',
            );
            console.error(`Please add to your shell profile: export PATH="$HOME/.dotnet:$PATH"`);
            console.error('Then restart your terminal and run: pnpm run dotnet:env');
            process.exit(1);
          }
        }
      } else {
        // If auto-install failed, show manual instructions
        const majorVersion = requiredDotNetVersion.split('.')[0];
        console.log(`\nPlease install .NET SDK ${majorVersion}.0 or higher manually:`);
        console.log(`  - Windows: https://dotnet.microsoft.com/download/dotnet/${majorVersion}.0`);
        console.log(
          `  - macOS/Linux: https://dotnet.microsoft.com/download/dotnet/${majorVersion}.0`,
        );
        process.exit(1);
      }
    } else if (!AUTO_INSTALL_ENABLED) {
      // Auto-install is disabled, show manual instructions
      const majorVersion = requiredDotNetVersion.split('.')[0];
      console.log(`\nPlease install .NET SDK ${majorVersion}.0 or higher:`);
      console.log(`  - Windows: https://dotnet.microsoft.com/download/dotnet/${majorVersion}.0`);
      console.log(
        `  - macOS/Linux: https://dotnet.microsoft.com/download/dotnet/${majorVersion}.0`,
      );
      process.exit(1);
    }
  }

  // Step 3: Check and install global tools if needed
  console.log('\nChecking for required .NET global tools...');

  if (skipTools) {
    console.log('Skipping .NET global tools installation (--skip-tools option used).');
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
  if (!checkNxDotNetPluginInstalled()) {
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

  // Reload the current shell so dotnet is available immediately without
  // closing the terminal. `exec zsh` replaces the current shell process
  // with a fresh one that sources ~/.zshrc — making dotnet available right away.
  //
  // Skip in CI / non-interactive contexts: spawning a login shell with
  // stdio:'inherit' has no TTY to attach to there, and can hang the step
  // (e.g. CI's `pnpm run dotnet:env`) until the job times out.
  const isCI = Boolean(process.env.CI);
  const isInteractive = Boolean(process.stdout.isTTY && process.stdin.isTTY);
  if (!isWindows && !isCI && isInteractive) {
    const shell = process.env.SHELL || '/bin/zsh';
    console.log(`\n🔄 Reloading shell to apply PATH changes...`);
    // Use spawnSync with stdio:'inherit' so the new shell takes over the terminal
    spawnSync(shell, ['-l'], { stdio: 'inherit' });
  }
}

// Run the setup
setupDotNetEnvironment().catch((error) => {
  console.error('Error during setup:', error);
  process.exit(1);
});
