#!/usr/bin/env node
/**
 * NOT WIRED INTO ANY BUILD SCRIPT. See #157 for the pending decision on where this runs.
 *
 * Fails while any legal content module is a draft placeholder, restricted to a production build
 * by `isProductionBuild()`. The restriction cannot fire correctly today: `build-push-images.yml`
 * runs the identical `docker build` (same Dockerfile, same build-args, including
 * `NEXT_BUILD_STANDALONE=1`) for the dev, test, and prod jobs, and re-tags the one resulting
 * image per environment afterward. GitHub Actions also sets `CI=true` on every job, PR
 * validation included. Neither signal distinguishes a production build from a dev or test one,
 * so wiring this into `package.json`/`project.json` failed CI and the image build for every
 * environment (see #157 comments).
 *
 * `isProductionBuild()` and this script are kept, tested, and ready to wire in once #157 settles
 * on where enforcement lives: a real per-environment build-arg threaded through
 * `build-push-images.yml` → `build-push-image` → `Dockerfile`, or a deploy-time check instead of
 * a build-time one.
 */
const path = require('path');
const { isProductionBuild } = require('./is-production-build');

const CONTENT_DIR = path.join(__dirname, '..', 'src', 'content', 'legal');
const CONTENT_FILES = ['privacy.json', 'terms.json'];

/** Returns the file names, from `files` in `contentDir`, whose module has `isDraft: true`. */
function findDraftFiles(contentDir, files) {
  return files.filter((file) => {
    const content = require(path.join(contentDir, file));
    return content.isDraft === true;
  });
}

function main() {
  if (!isProductionBuild()) {
    return;
  }

  const draftFiles = findDraftFiles(CONTENT_DIR, CONTENT_FILES);

  if (draftFiles.length > 0) {
    console.error('Legal content gate failed. The following modules are still draft placeholders:');
    for (const file of draftFiles) {
      console.error(`  - src/content/legal/${file}`);
    }
    console.error('Approve copy in #156 and set isDraft to false before building.');
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { findDraftFiles };
