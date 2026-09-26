const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

module.exports = {
  output: {
    path: join(__dirname, '../../../dist/apps/services/property-service'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      // Seeding runs inside the cluster, from the `migrate` initContainer (#111), so its code has to
      // reach the runtime image. It is not imported by main.ts — deliberately, a dev-only concern
      // stays off the production startup path — so without its own entry it would not be bundled at
      // all and `migrate.js` would have nothing to spawn.
      additionalEntryPoints: [
        {
          entryName: 'seed-on-start',
          entryPath: './src/seed/seed-on-start.main.ts',
        },
        // The Bright MLS ingestion job (#91) runs as its own scheduled process — the workload is
        // throughput-bound and must not compete with request-serving CPU (see AGENTS.md, "the split
        // that does matter is by workload, not language"). It reuses this image with a different
        // command, which is why it needs its own entry: nothing in main.ts imports it, so without
        // this it would not reach the runtime image and the CronJob would have nothing to run.
        {
          entryName: 'bright-ingest',
          entryPath: './src/jobs/bright-ingest/bright-ingest.main.ts',
        },
        // The Bright `$count` audit (#328): a manually-run diagnostic, not a CronJob. Nothing on
        // the request-serving or ingestion startup path imports it, so it needs its own entry for
        // the same reason `bright-ingest` does.
        {
          entryName: 'bright-audit',
          entryPath: './src/jobs/bright-ingest/bright-audit.main.ts',
        },
      ],
      tsConfig: './tsconfig.app.json',
      assets: ['./src/assets'],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: true,
      sourceMaps: true,
    }),
  ],
};
