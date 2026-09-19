/**
 * Sample-marking for Bright rows (#93).
 *
 * Stakeholder ruling 2026-09-19: `local`, `dev` and `test` authenticate against Bright's test feed;
 * only `prod` reaches the licensed production feed. A row from the test feed is not production
 * inventory, so it must be marked `is_sample=true` and carry the shipped (#115) `(Sample)` title
 * disclosure. Derived from the configured feed tier, never from an environment name or a run flag —
 * an unconfigured or unrecognised feed value fails closed to sample-marked.
 */

export type BrightFeedTier = 'test' | 'production';

export function isSampleFeed(feed: BrightFeedTier): boolean {
  return feed !== 'production';
}

const SAMPLE_SUFFIX = ' (Sample)';

/** Idempotent: re-processing the same record must not double-suffix its title. */
export function withSampleSuffix(title: string): string {
  return title.endsWith(SAMPLE_SUFFIX) ? title : `${title}${SAMPLE_SUFFIX}`;
}
