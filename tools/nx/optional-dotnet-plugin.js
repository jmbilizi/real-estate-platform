'use strict';

/**
 * Nx plugin wrapper for `@nx/dotnet`, registered in nx.json. An installed .NET SDK always wins:
 * each graph build checks for `dotnet` and then runs the real plugin. With no `dotnet` on PATH,
 * the wrapper gives no .NET nodes, so Node and Python work runs without the SDK.
 */

const { createDotnetDetector, createOptionalPlugin } = require('./optional-dotnet-plugin-core');

module.exports = createOptionalPlugin({
  real: require('@nx/dotnet'),
  hasDotnet: createDotnetDetector(),
  warn: (message) => console.warn(message),
});
