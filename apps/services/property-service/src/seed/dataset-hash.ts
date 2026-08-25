import { createHash } from 'node:crypto';

import { mockListings } from './mock-listings';
import { MockListing } from './types';

/**
 * A content hash of the sample dataset, used to decide whether an already-seeded database is holding
 * the dataset this image ships (#111).
 *
 * It hashes the DATA, deliberately, and not the image tag or the build time. Those change on every
 * rebuild, which would make a redeploy destructively re-seed a database whose sample rows were
 * already correct — churn indistinguishable from a real dataset change. Hashing the content means a
 * rebuild with no dataset edit is a no-op, and an edit is picked up on the next deploy without
 * anyone having to remember to bump anything.
 *
 * `JSON.stringify` over the array is stable enough for this job: the dataset is a literal in source,
 * so property order is fixed by the file itself and only an actual edit moves it. A reorder that
 * changes no values would still re-seed — a false positive costs one redundant re-seed of sample
 * data, which is the harmless direction to be wrong in.
 */
export function computeDatasetHash(listings: readonly MockListing[] = mockListings): string {
  return createHash('sha256').update(JSON.stringify(listings)).digest('hex');
}
