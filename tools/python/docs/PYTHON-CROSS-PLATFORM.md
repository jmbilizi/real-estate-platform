# Python Environment Setup

This monorepo supports Python development across multiple platforms (Windows, macOS, and Linux).

## File Organization

The Python setup scripts are organized as follows:

```
/
├── tools/
│   ├── hooks/                # Unified Git hooks system
│   │   ├── setup-hooks.js    # Hooks setup script
│   │   └── hooks-runner.js   # Core hook execution script
│   └── python/
│       ├── setup.js          # Unified Python environment management script
│       ├── scripts/          # Platform-specific scripts
│       │   ├── install-python-direct.bat
│       │   ├── install-python-direct.sh
│       │   ├── check-python-ondemand.bat
│       │   └── check-python-ondemand.sh
│       └── docs/
│           └── README-PYTHON.md
```

## Cross-Platform Scripts

The Python environment management is handled through a unified Node.js script that works on all platforms:

- `setup.js` - The main cross-platform script for Python environment management
- Supporting platform-specific scripts for direct installation and checks

## Platform-Specific Implementation

Each platform has its own implementation for Python installation and environment management:

### Windows

- `install-python-direct.bat` - Python installer for Windows
- `check-python-ondemand.bat` - On-demand Python check for Windows

### macOS/Linux

- `install-python-direct.sh` - Python installer for macOS/Linux
- `check-python-ondemand.sh` - On-demand Python check for macOS/Linux

## npm Scripts

All Python commands are available through npm scripts that work across platforms:

```bash
# Two-phase setup
npm run py:install   # Phase 1: Install Python if needed
npm run py:setup     # Phase 2: Create venv and install packages

# Environment management
npm run py:check     # Verify Python and environment setup
npm run py:create-venv  # Create virtual environment only
npm run py:install-packages  # Install all packages
npm run py:install-dev  # Install development packages
npm run py:activate  # Show activation instructions
npm run setup-hooks  # Set up Git hooks (unified system)
```

## Using the Python Environment CLI

You can also use the Python environment CLI directly:

```bash
# For all platforms
node tools/python/setup.js [command] [options]
```

Available commands:

- `install` - Check and install Python if needed
- `setup` - Create virtual environment and install packages
- `check` - Verify Python and environment setup
- `venv` - Create virtual environment only
- `packages [type]` - Install packages (all, dev, format, main)
- `hooks` - Set up Git hooks (redirects to unified hooks system)
- `activate` - Show activation instructions
- `help` - Show help information

## Environment Activation

To activate the Python virtual environment:

- Windows:

  ```
  .venv\Scripts\activate
  ```

- macOS/Linux:
  ```
  source .venv/bin/activate
  ```

## Future Language Support

This organization is designed to support additional languages in the future. Each language can follow a similar pattern:

```
/tools
├── python/                   # Python support
├── rust/                     # Future Rust support
├── dotnet/                   # Future .NET support
└── go/                       # Future Go support
```

Each language folder would contain its own implementation, scripts, and documentation.
