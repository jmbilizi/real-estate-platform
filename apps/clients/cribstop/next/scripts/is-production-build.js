/**
 * True for the build that produces a deployable artifact.
 *
 * GitHub Actions sets `CI=true` on every runner, and the Docker builder stage sets
 * `NEXT_BUILD_STANDALONE=1` (see `Dockerfile`). Both are the same condition `next.config.js`
 * already uses to switch on standalone output, so this file is the one place that decides it,
 * shared by both, and the two can never drift apart.
 */
function isProductionBuild() {
  return Boolean(process.env.CI) || Boolean(process.env.NEXT_BUILD_STANDALONE);
}

module.exports = { isProductionBuild };
