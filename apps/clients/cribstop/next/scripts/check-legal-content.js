#!/usr/bin/env node
/**
 * Deploy-time gate for #219. Runs only from the prod job of `deploy-k8s-resources.yml`, never
 * at build time. #157 tried `isProductionBuild()` (`CI` / `NEXT_BUILD_STANDALONE`). Both are set
 * the same way in dev, test, and prod, so neither can tell the environments apart.
 * `DEPLOYMENT_ENV` can. The workflow step sets it to `prod` only in the prod job.
 */
const path = require('path');

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
  if (process.env.DEPLOYMENT_ENV !== 'prod') {
    return;
  }

  const draftFiles = findDraftFiles(CONTENT_DIR, CONTENT_FILES);

  if (draftFiles.length > 0) {
    console.error('Legal content gate failed. The following modules are still draft placeholders:');
    for (const file of draftFiles) {
      console.error(`  - src/content/legal/${file}`);
    }
    console.error('Approve copy in #156 and set isDraft to false before the prod deploy.');
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { findDraftFiles };
