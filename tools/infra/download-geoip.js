#!/usr/bin/env node

/**
 * Download MaxMind GeoLite2-City database for local development
 *
 * Usage:
 *   pnpm run geoip:download
 *
 * Requirements:
 *   - MAXMIND_LICENSE_KEY environment variable (get free key at https://www.maxmind.com/en/geolite2/signup)
 *
 * Recommended: Set as environment variable in your shell:
 *   - PowerShell:  $env:MAXMIND_LICENSE_KEY = "your_key"
 *   - CMD:         set MAXMIND_LICENSE_KEY=your_key
 *   - Bash:        export MAXMIND_LICENSE_KEY=your_key
 *
 * Alternative: Add to workspace root .env file (preserved across Python/other tool updates):
 *   MAXMIND_LICENSE_KEY=your_key_here
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const OUTPUT_DIR = path.join(__dirname, "../../apps/api-gateway");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "GeoLite2-City.mmdb");
const ROOT_ENV_FILE = path.join(__dirname, "../../.env");

function log(message, type = "info") {
  const icons = { info: "ℹ️", success: "✅", error: "❌", warn: "⚠️" };
  console.log(`${icons[type] || icons.info} ${message}`);
}

function getLicenseKey() {
  // Check environment variable
  if (process.env.MAXMIND_LICENSE_KEY) {
    return process.env.MAXMIND_LICENSE_KEY;
  }

  // Check .env file in workspace root
  if (fs.existsSync(ROOT_ENV_FILE)) {
    const envContent = fs.readFileSync(ROOT_ENV_FILE, "utf8");
    const match = envContent.match(/MAXMIND_LICENSE_KEY=(.+)/);
    if (match) {
      return match[1].trim();
    }
  }

  return null;
}

function downloadFile(url, dest) {
  // Use curl (same as Dockerfile) - much faster than Node's https module
  // -L = follow redirects, -S = show errors, -# = progress bar
  try {
    execSync(`curl -L -S -# "${url}" -o "${dest}"`, {
      stdio: "inherit", // Show curl's progress bar
      maxBuffer: 100 * 1024 * 1024, // 100MB buffer for large files
    });
  } catch (error) {
    // Clean up on failure
    if (fs.existsSync(dest)) {
      fs.unlinkSync(dest);
    }
    throw error;
  }
}

async function main() {
  log("🌍 MaxMind GeoIP2 Database Downloader");
  console.log("");

  // Check if file already exists
  if (fs.existsSync(OUTPUT_FILE)) {
    const stats = fs.statSync(OUTPUT_FILE);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    log(`Database already exists: ${OUTPUT_FILE} (${sizeMB} MB)`, "info");

    const readline = require("readline").createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise((resolve) => {
      readline.question("Re-download? (y/N): ", resolve);
    });
    readline.close();

    if (answer.toLowerCase() !== "y") {
      log("Keeping existing database", "info");
      process.exit(0);
    }
  }

  // Get license key
  const licenseKey = getLicenseKey();
  if (!licenseKey) {
    log("MAXMIND_LICENSE_KEY not found", "error");
    console.log("");
    console.log("📋 Setup Instructions:");
    console.log("");
    console.log("1. Sign up (free): https://www.maxmind.com/en/geolite2/signup");
    console.log("2. Generate key: https://www.maxmind.com/en/accounts/current/license-key");
    console.log("3. Set environment variable:");
    console.log("");
    console.log("   Windows (PowerShell):");
    console.log('   $env:MAXMIND_LICENSE_KEY="your_key_here"');
    console.log("");
    console.log("   Windows (CMD):");
    console.log("   set MAXMIND_LICENSE_KEY=your_key_here");
    console.log("");
    console.log("   Unix/macOS:");
    console.log("   export MAXMIND_LICENSE_KEY=your_key_here");
    console.log("");
    console.log("   OR add to workspace root .env file (gitignored):");
    console.log("   MAXMIND_LICENSE_KEY=your_key_here");
    console.log("");
    console.log("4. Run this script again: pnpm run geoip:download");
    console.log("");
    process.exit(1);
  }

  log("License key found: " + licenseKey.substring(0, 8) + "...", "success");

  // Download database
  const downloadUrl = `https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-City&license_key=${licenseKey}&suffix=tar.gz`;
  const tarFile = path.join(OUTPUT_DIR, "GeoLite2-City.tar.gz");

  try {
    log("Downloading GeoLite2-City database...", "info");
    downloadFile(downloadUrl, tarFile);

    const stats = fs.statSync(tarFile);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    log(`Downloaded: ${sizeMB} MB`, "success");

    // Extract .mmdb file
    log("Extracting database...", "info");

    // Create temp directory for extraction
    const tempDir = path.join(OUTPUT_DIR, "temp-geoip");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Extract using tar (cross-platform)
    try {
      execSync(`tar -xzf "${tarFile}" -C "${tempDir}"`, { stdio: "ignore" });
    } catch (err) {
      log("tar command not found, trying manual extraction...", "warn");
      throw new Error("Please install tar or 7-zip to extract the database");
    }

    // Find the .mmdb file (it's in a dated directory)
    const extractedDirs = fs.readdirSync(tempDir);
    let mmdbFound = false;

    for (const dir of extractedDirs) {
      const dirPath = path.join(tempDir, dir);
      if (fs.statSync(dirPath).isDirectory()) {
        const mmdbPath = path.join(dirPath, "GeoLite2-City.mmdb");
        if (fs.existsSync(mmdbPath)) {
          fs.copyFileSync(mmdbPath, OUTPUT_FILE);
          mmdbFound = true;
          break;
        }
      }
    }

    if (!mmdbFound) {
      throw new Error("GeoLite2-City.mmdb not found in extracted archive");
    }

    // Cleanup
    fs.rmSync(tarFile);
    fs.rmSync(tempDir, { recursive: true, force: true });

    const finalStats = fs.statSync(OUTPUT_FILE);
    const finalSizeMB = (finalStats.size / 1024 / 1024).toFixed(2);
    log(`Database installed: ${OUTPUT_FILE} (${finalSizeMB} MB)`, "success");

    // Update root .env file to add MAXMIND_LICENSE_KEY if it came from environment variable
    try {
      let envContent = "";
      let hasMaxMindKey = false;

      // Read existing .env if it exists
      if (fs.existsSync(ROOT_ENV_FILE)) {
        envContent = fs.readFileSync(ROOT_ENV_FILE, "utf8");
        hasMaxMindKey = /MAXMIND_LICENSE_KEY=/.test(envContent);
      }

      // Add MAXMIND_LICENSE_KEY if it came from env var and not already in file
      if (!hasMaxMindKey && process.env.MAXMIND_LICENSE_KEY) {
        if (!envContent.endsWith("\n")) {
          envContent += "\n";
        }
        envContent += "\n# GeoIP Database License (optional - for local development only)\n";
        envContent += `MAXMIND_LICENSE_KEY=${process.env.MAXMIND_LICENSE_KEY}\n`;

        fs.writeFileSync(ROOT_ENV_FILE, envContent, "utf8");
        log(`Added MAXMIND_LICENSE_KEY to .env file`, "success");
      } else if (hasMaxMindKey) {
        log(`MAXMIND_LICENSE_KEY already in .env file`, "info");
      }
    } catch (error) {
      log(`Warning: Could not update .env file: ${error.message}`, "warn");
    }

    console.log("");
    log("🎉 GeoIP database ready for local development!", "success");
    console.log("");
    console.log("Next steps:");
    console.log("1. Start local cluster: pnpm run infra:local:cluster:setup");
    console.log("2. Run Skaffold: node tools/infra/dev-skaffold.js");
    console.log("3. Send test requests to see geographic tags in Jaeger");
    console.log("");
  } catch (error) {
    log(`Failed to download database: ${error.message}`, "error");

    // Cleanup on error
    if (fs.existsSync(tarFile)) {
      fs.rmSync(tarFile);
    }

    console.log("");
    console.log("💡 Troubleshooting:");
    console.log("- Verify your license key is valid");
    console.log("- Check internet connection");
    console.log("- Ensure tar is installed (Git for Windows includes it)");
    console.log("");

    process.exit(1);
  }
}

main().catch((err) => {
  log(`Unexpected error: ${err.message}`, "error");
  process.exit(1);
});
