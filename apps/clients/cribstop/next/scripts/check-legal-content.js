#!/usr/bin/env node
/**
 * Fails the production build while any legal content module is still a draft placeholder.
 *
 * #156 delivers approved copy for `/privacy` and `/terms`. Until then this is the only thing
 * that stops a draft policy from reaching a consumer (#157) — the pages themselves show a draft
 * banner, but only this gate can stop a build.
 */
const path = require('path');

const CONTENT_DIR = path.join(__dirname, '..', 'src', 'content', 'legal');
const CONTENT_FILES = ['privacy.json', 'terms.json'];

const draftFiles = CONTENT_FILES.filter((file) => {
  const content = require(path.join(CONTENT_DIR, file));
  return content.isDraft === true;
});

if (draftFiles.length > 0) {
  console.error('Legal content gate failed. The following modules are still draft placeholders:');
  for (const file of draftFiles) {
    console.error(`  - src/content/legal/${file}`);
  }
  console.error('Approve copy in #156 and set isDraft to false before building.');
  process.exit(1);
}
