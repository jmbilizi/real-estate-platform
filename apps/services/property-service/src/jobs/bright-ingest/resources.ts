/**
 * The Bright resources this job can replicate (#92).
 *
 * ## The cursor field is data, not a constant
 *
 * RESO practice says "filter on `ModificationTimestamp`". Bright's feed does not obey that for every
 * resource, and the difference is not cosmetic. Verified against the live test feed on 2026-09-18
 * and re-read from the committed `docs/bright-mls/bright-metadata.xml`:
 *
 *  - `BrightProperties` uses `ModificationTimestamp`, key `ListingKey`.
 *  - `BrightMedia` has **no** `ModificationTimestamp` at all. It uses `MediaModificationTimestamp`,
 *    key `MediaKey`. There is also no `Media` navigation property on `BrightProperty`, so
 *    `$expand=Media` returns 400 and media is a separate pass rather than a join.
 *  - `Deletion` uses `DeletionTimestamp`, key `UniversalKey`.
 *
 * A constant cursor field name would therefore have worked for listings and returned an empty or
 * rejected query for the other two. So the name lives here, per resource, and every query is built
 * from this table.
 *
 * ## Deletion is a resource, not a special case
 *
 * The `Deletion` resource holds 10.5 million rows on the test feed. A full read is not an option, so
 * it gets the same bounded cursor as every other resource and lands in the same staging table with
 * its own `resource` value. That is also what keeps the promise in the ticket that a second resource
 * is configuration and not a fork: #129 and #130 add a row here, not a code path.
 */

/** One replicable Bright entity set. */
export interface BrightResource {
  /** The entity set name in the URL path. `BrightProperties`, not the RESO-standard `Property`. */
  readonly entitySet: string;
  /** The key field, used as the tiebreak in `$orderby` and as the staging primary key. */
  readonly keyField: string;
  /** The field a run filters and orders on. Per resource — see the header. */
  readonly cursorField: string;
  /** What a run reports this resource as. Kept separate so a rename at Bright stays local. */
  readonly kind: 'records' | 'deletions';
}

export const BRIGHT_RESOURCES: Readonly<Record<string, BrightResource>> = Object.freeze({
  BrightProperties: Object.freeze({
    entitySet: 'BrightProperties',
    keyField: 'ListingKey',
    cursorField: 'ModificationTimestamp',
    kind: 'records',
  }),
  BrightMedia: Object.freeze({
    entitySet: 'BrightMedia',
    keyField: 'MediaKey',
    cursorField: 'MediaModificationTimestamp',
    kind: 'records',
  }),
  Deletion: Object.freeze({
    entitySet: 'Deletion',
    keyField: 'UniversalKey',
    cursorField: 'DeletionTimestamp',
    kind: 'deletions',
  }),
});

export const BRIGHT_RESOURCE_NAMES: readonly string[] = Object.freeze(
  Object.keys(BRIGHT_RESOURCES),
);

/**
 * Resolves a configured resource name.
 *
 * Throws on an unknown name rather than skipping it. A typo in `BRIGHT_MLS_RESOURCES` that silently
 * replicated nothing would present as "the feed is empty", which points every investigation at
 * Bright instead of at the CronJob's own environment.
 */
export function resolveResource(name: string): BrightResource {
  const resource = BRIGHT_RESOURCES[name];
  if (resource === undefined) {
    throw new Error(
      `Unknown Bright resource "${name}". Known resources: ${BRIGHT_RESOURCE_NAMES.join(', ')}. ` +
        'Add it to src/jobs/bright-ingest/resources.ts with its own key and cursor field — the ' +
        'cursor field is per resource and BrightMedia does not have ModificationTimestamp.',
    );
  }
  return resource;
}
