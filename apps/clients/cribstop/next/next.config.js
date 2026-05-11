/** @type {import('next').NextConfig} */
const path = require('path');
const nextConfig = {
  reactStrictMode: true,
  // standalone output: enabled in CI and container builds, skipped on Windows dev
  // (requires symlink privileges not available on Windows by default)
  ...(process.env.CI || process.env.NEXT_BUILD_STANDALONE ? { output: 'standalone' } : {}),
  // outputFileTracingRoot: tells nft to trace from the monorepo root so the standalone
  // output includes root node_modules (with pnpm virtual store symlinks), fixing
  // 'Cannot find module next' at runtime. In Next.js 15, this is a top-level key.
  outputFileTracingRoot: path.join(__dirname, '../../../..'),
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'picsum.photos' },
    ],
  },
};

module.exports = nextConfig;
