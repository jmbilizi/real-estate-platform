#!/usr/bin/env node
/**
 * Fails the production build while any legal content module is a draft placeholder.
 *
 * #156 delivers approved copy for `/privacy` and `/terms`. Until then, this gate stops a draft
 * policy from reaching a build. The pages also show a draft banner, but only this gate can stop
 * a build.
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
