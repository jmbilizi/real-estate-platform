/** @type {import('next').NextConfig} */
const path = require('path');
const { isProductionBuild } = require('./scripts/is-production-build');
const { frameHosts } = require('./src/lib/tour-hosts.json');
const nextConfig = {
  reactStrictMode: true,
  // standalone output: enabled in CI and container builds, skipped on Windows dev
  // (requires symlink privileges not available on Windows by default)
  ...(isProductionBuild() ? { output: 'standalone' } : {}),
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
  // frame-src is the only directive set. It limits iframes to the tour hosts the gallery embeds (#573, #590).
  // frame-src also checks every redirect target, so list the host a tour URL redirects to.
  async headers() {
    const frameSrc = ["'self'", ...frameHosts.map((h) => `https://${h}`)].join(' ');
    return [
      {
        source: '/:path*',
        headers: [{ key: 'Content-Security-Policy', value: `frame-src ${frameSrc}` }],
      },
    ];
  },
};

module.exports = nextConfig;
