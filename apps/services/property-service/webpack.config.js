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
