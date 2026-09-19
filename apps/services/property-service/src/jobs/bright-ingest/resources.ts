/**
 * The Bright resources this job knows about, and what each one actually supports (#92).
 *
 * ## The cursor field is data, not a constant
 *
 * RESO practice says "filter on `ModificationTimestamp`". Bright's feed does not obey that for every
 * resource. Read from the committed `docs/bright-mls/bright-metadata.xml`:
 *
 *  - `BrightProperties` uses `ModificationTimestamp`, key `ListingKey`.
 *  - `BrightMedia` has **no** `ModificationTimestamp` at all — a filter naming it answers "The
 *    property 'ModificationTimestamp' ... is not defined in type ... BrightMedia". It carries
 *    `MediaModificationTimestamp`, key `MediaKey`.
 *  - `Deletion` carries `DeletionTimestamp`, key `UniversalKey`.
 *
 * ## Only `BrightProperties` can be replicated incrementally on this tier
 *
 * This is the finding that matters, measured against the live test feed on 2026-09-19 with the
 * `BRIGHTIDXTEST` account. **`BrightMedia` and `Deletion` accept no `$filter` at all.** Not on the
 * timestamp, and not even on their own key:
 *
 * | Query                                              | Answer                                        |
 * | -------------------------------------------------- | --------------------------------------------- |
 * | `BrightProperties?$filter=ModificationTimestamp gt t` | 200, 1000 records, `@odata.nextLink`        |
 * | `BrightMedia` with no query options                  | 200, 1000 records, `@odata.nextLink`        |
 * | `BrightMedia?$filter=MediaModificationTimestamp gt t` | 400 `Edm.Boolean and Edm.DateTimeOffset ...` |
 * | `BrightMedia?$filter=MediaKey gt 1`                  | 400 `Edm.Boolean and Edm.Int64 ...`          |
 * | `Deletion` with no query options                     | 200, 1000 records, `@odata.nextLink`        |
 * | `Deletion?$filter=DeletionTimestamp gt t`            | 400 `Edm.Boolean and Edm.DateTimeOffset ...` |
 * | `Deletion?$orderby=DeletionTimestamp asc`            | 400 `$orderby has the not-allowed value`     |
 *
 * So both are readable only as unfiltered, unordered scans — 3.4 million and 10.5 million rows. An
 * incremental pass over either is not expressible, and an unbounded scan does not fit a scheduled
 * job. `supportsCursorQuery` records that as data rather than as a comment, and `buildCursorQuery`
 * refuses rather than sending a request that is known to answer 400.
 *
 * **Do not read this as "media and deletions are impossible".** It is one IDX test account. The
 * question of which tier or entitlement makes those two filterable belongs to Bright support, and
 * is tracked separately. When the answer arrives, the change here is a flag, not a code path — which
 * is the promise this table exists to keep for #129 and #130.
 */

/** One Bright entity set. */
export interface BrightResource {
  /** The entity set name in the URL path. `BrightProperties`, not the RESO-standard `Property`. */
  readonly entitySet: string;
  /** The key field, used as the `$orderby` tiebreak and as the staging primary key. */
  readonly keyField: string;
  /** The field a run filters and orders on. Per resource — see the header. */
  readonly cursorField: string;
  /** What a run reports this resource as. Kept separate so a rename at Bright stays local. */
  readonly kind: 'records' | 'deletions';
  /**
   * Whether the feed answers a `$filter` on the cursor field. `false` means the resource exists and
   * is readable, but only as an unbounded scan — so this job will not touch it.
   */
  readonly supportsCursorQuery: boolean;
}

export const BRIGHT_RESOURCES: Readonly<Record<string, BrightResource>> = Object.freeze({
  BrightProperties: Object.freeze({
    entitySet: 'BrightProperties',
    keyField: 'ListingKey',
    cursorField: 'ModificationTimestamp',
    kind: 'records',
    supportsCursorQuery: true,
  }),
  BrightMedia: Object.freeze({
    entitySet: 'BrightMedia',
    keyField: 'MediaKey',
    cursorField: 'MediaModificationTimestamp',
    kind: 'records',
    supportsCursorQuery: false,
  }),
  Deletion: Object.freeze({
    entitySet: 'Deletion',
    keyField: 'UniversalKey',
    cursorField: 'DeletionTimestamp',
    kind: 'deletions',
    supportsCursorQuery: false,
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
 *
 * Throws on a known resource the feed will not filter, for the same reason: configuring one and
 * getting a nightly 400 is a worse answer than refusing at startup with the evidence.
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
  if (!resource.supportsCursorQuery) {
    throw new Error(
      `Bright resource "${name}" cannot be replicated incrementally: this feed tier answers 400 to ` +
        `every $filter on it, including one on its own key ${resource.keyField}. Measured ` +
        '2026-09-19. See the table in src/jobs/bright-ingest/resources.ts. Configuring it would ' +
        'produce a nightly failed Job, not data.',
    );
  }
  return resource;
}
