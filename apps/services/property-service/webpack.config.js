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
      additionalEntryPoints: [
        // The Bright sync worker (#338) runs as its own long-running process: the workload is
        // throughput-bound and must not compete with request-serving CPU. Nothing in main.ts imports
        // it, so it needs its own entry to reach the runtime image.
        {
          entryName: 'bright-sync-worker',
          entryPath: './src/jobs/bright-sync/bright-sync-worker.main.ts',
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
