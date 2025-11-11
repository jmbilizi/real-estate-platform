# Unified Git Hooks System

This document describes the unified Git hooks system used in the Polyglot monorepo.

## Overview

The unified hooks system centralizes Git hook management across all languages and frameworks in the monorepo, including:

- JavaScript/TypeScript
- Python
- .NET/C#
- SQL
- YAML/XML

Instead of having separate hook systems for each language, this approach:

1. Detects which types of files are being changed
2. Sets up the appropriate environment for those languages
3. Runs the appropriate linters, formatters, and checks
4. Ensures consistent behavior across all languages

## Hooks Available

The system provides the following hooks:

### Pre-Commit Hook

Runs whenever you create a commit:

- Detects which file types are being staged
- Sets up language-specific environments as needed
- Runs appropriate linters and formatters for staged files
- Prevents commits with failing checks

### Post-Merge Hook

Runs after merging changes from another branch:

- Detects changes to dependency files
- Automatically installs updated dependencies
- Handles package.json, requirements.txt, and .csproj changes

### Pre-Push Hook

Runs before pushing commits to a remote repository:

- Runs tests for the affected language stacks
- Prevents pushing if tests fail

## Setup

To set up or update the Git hooks, run:

```bash
npm run hooks:setup
```

This script will:

1. Install and configure Husky
2. Set up appropriate pre-commit, post-merge, and pre-push hooks
3. Configure language-specific environments as needed (Python, Node.js, .NET)

## Integration with Python

If you're using the Python tooling in this monorepo, you can also set up the hooks by running:

```bash
npm run py:setup
```

This will set up the Python environment and also configure the unified hooks system.

## Architecture

The hooks system consists of two main components:

1. **setup-hooks.js**: Sets up the Husky hooks and configures the necessary environments
2. **hooks-runner.js**: A central script that runs when Git hooks are triggered

The hooks-runner.js script:

1. Detects what types of files are being modified
2. Sets up the appropriate language environments
3. Runs the necessary checks, tests, or installation tasks

## Customization

If you need to add custom behavior to the hooks, modify the hooks-runner.js file. The script is organized by hook type (pre-commit, post-merge, pre-push) and has language-specific sections.

## Troubleshooting

If you encounter issues with the hooks:

1. Make sure you have all the necessary dependencies installed
2. Try running `npm run hooks:setup` to reconfigure the hooks
3. Check that the language-specific tools are properly installed
4. Examine the output of the failing hook for specific error messages

The hooks system is automatically set up when you run:

```bash
npm run hooks:setup
```

This will:

1. Install Husky for Git hook integration
2. Create the hook scripts in the .husky directory
3. Configure language-specific environments

## Manual Activation

If hooks are not running properly, you can manually set them up:

```bash
# Reinstall Husky
npm run prepare

# Set up the hooks system
npm run hooks:setup
```

## How It Works

The system uses:

1. **Husky**: To integrate with Git hooks
2. **hooks-runner.js**: A central script that orchestrates hook execution
3. **lint-staged**: For efficient linting of staged files
4. **Language-specific tools**: Each configured to work within the hooks system

## Extending the System

To add support for a new language or framework:

1. Update the file pattern detection in `hooks-runner.js`
2. Add linting/formatting configuration to `lint-staged` in package.json
3. If needed, add language-specific environment setup

## Troubleshooting

If hooks are failing or not running:

1. Ensure Husky is properly installed (`npm run prepare`)
2. Check that the hook scripts exist in the `.husky` directory
3. Verify language-specific tools are installed
4. Run `npm run hooks:setup` to recreate the hook configuration
