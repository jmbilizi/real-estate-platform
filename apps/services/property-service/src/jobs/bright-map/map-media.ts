/**
 * Maps one `BrightMedia` record onto a `listing_media` row, and orders a listing's gallery (#191).
 *
 * This is the pure half, like `map-record.ts`. It reads a staged payload and returns a value. It
 * touches no database and no clock. `run.ts` groups the results per listing and writes them.
 *
 * ## The field names come from the feed's own `$metadata`
 *
 * Every name below is declared on the `BrightMedia` entity type in the committed
 * `docs/bright-mls/bright-metadata.xml`. None is inferred from RESO in general, because this feed
 * departs from RESO in exactly this area: the entity set is `BrightMedia`, and the timestamp is
 * `MediaModificationTimestamp` rather than `ModificationTimestamp`.
 *
 * | Purpose             | Bright field           | Type             |
 * | ------------------- | ---------------------- | ---------------- |
 * | Media identity      | `MediaKey`             | Edm.Int64, key   |
 * | Link to the listing | `ResourceRecordKey`    | Edm.Int64        |
 * | Image URL           | `MediaURL`             | Edm.String       |
 * | Preferred photo     | `PreferredPhotoYN`     | Edm.Boolean      |
 * | Gallery order       | `MediaDisplayOrder`    | Edm.Int16        |
 * | Accessible name     | `MediaShortDescription`| Edm.String, 50   |
 * | Caption             | `MediaLongDescription` | Edm.String, 1024 |
 * | Mime type           | `MediaType`            | Edm.String       |
 * | Owning resource     | `ResourceName`         | Edm.String       |
 *
 * ## THE PRIMARY-IMAGE RULE, and why it is the feed's choice and not ours
 *
 * The feed designates a preferred photo. So the rule reads that designation first, and only invents
 * a tiebreak where the feed leaves one open:
 *
 *  1. `PreferredPhotoYN === true` wins.
 *  2. Then the lowest `MediaDisplayOrder`. An absent order sorts LAST, never first: a missing value
 *     is unknown, and letting unknown outrank a stated order would silently beat the feed.
 *  3. Then the lowest `MediaKey`. This exists only to make the order TOTAL, so the same input
 *     always produces the same gallery. Without it a tie is resolved by array order, which is page
 *     arrival order, which changes between runs.
 *
 * `sort_order` follows the same comparison, so the gallery renders in the feed's order and the
 * primary image is its first element. Exactly one row per listing gets `is_primary`, which the
 * partial unique index `idx_listing_media_one_primary` also enforces.
 *
 * Two `PreferredPhotoYN: true` rows on one listing is feed data we cannot rule out. Steps 2 and 3
 * resolve it deterministically rather than failing the run over a photo ordering.
 *
 * ## Fail-closed, and counted
 *
 * A record this module cannot vouch for is rejected with a named reason, never mapped with a
 * guessed value. `run.ts` counts the reasons, so a feed change presents as a rejection spike in the
 * run report rather than as photos quietly disappearing.
 */

/** One `BrightMedia` record accepted for display. `run.ts` turns a group of these into rows. */
export interface MappedBrightMedia {
  /** The owning listing's `ListingKey`, from `ResourceRecordKey`. Stringified to match staging. */
  readonly listingKey: string;
  /** `MediaKey`, stringified. Lands in `listing_media.source_media_key` and makes re-runs idempotent. */
  readonly sourceMediaKey: string;
  readonly url: string;
  readonly altText: string | null;
  readonly caption: string | null;
  readonly displayOrder: number | null;
  readonly preferred: boolean;
  /** `MediaKey` as a number for the tiebreak. `bigint` because the field is `Edm.Int64`. */
  readonly mediaKeySort: bigint;
}

/** Why a record is not displayed. Each value is a counter key on the run report. */
export type BrightMediaRejection =
  | 'missing_media_key'
  | 'missing_listing_link'
  | 'missing_url'
  | 'wrong_resource'
  | 'not_a_photo'
  | 'unknown_media_type';

export type BrightMediaMapResult =
  | { readonly kind: 'mapped'; readonly media: MappedBrightMedia }
  | { readonly kind: 'rejected'; readonly reason: BrightMediaRejection };

/** A `listing_media` row's display fields, after the gallery is ordered. */
export interface GalleryEntry extends MappedBrightMedia {
  readonly sortOrder: number;
  readonly isPrimary: boolean;
}

const IMAGE_MIME = /^image\//i;

/**
 * Image extensions, matched on the URL path only.
 *
 * This is the SECOND photo test, used when `MediaType` is absent. It is not a preference: a stated
 * mime type always decides. `BrightMedia` also carries documents and video, and `MediaCategory` /
 * `MediaImageOf` would be the natural filters, but both are `Lookup`-backed and this tier answers
 * 400 to `Lookup` (#162). So their permitted values are unknown, and a rule written against a
 * guessed vocabulary would be worse than no rule.
 */
const IMAGE_EXTENSION = /\.(?:jpe?g|png|webp|gif|avif|bmp|tiff?)$/i;

/** Trimmed value, or `null` for anything that is not a non-empty string. */
function text(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * A key as a string, from either a number or a string.
 *
 * `Edm.Int64` crosses JSON as a number on this feed, but RESO permits a string, and a value past
 * `Number.MAX_SAFE_INTEGER` must arrive as one. Both are accepted. A non-integer number is refused,
 * because a rounded key points at the wrong record.
 */
function keyText(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) ? String(value) : null;
  }
  const raw = text(value);
  return raw !== null && /^\d+$/.test(raw) ? raw : null;
}

/** `Edm.Int16` display order, or `null`. A non-integer is `null`, which sorts last. */
function order(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  const raw = text(value);
  if (raw === null || !/^-?\d+$/.test(raw)) {
    return null;
  }
  return Number(raw);
}

/**
 * Whether the record's owning resource is the property resource.
 *
 * `ResourceRecordKey` is only meaningful with `ResourceName`. `BrightMedia` carries media for more
 * than one resource, and an office record's `ResourceRecordKey` can equal a listing's `ListingKey`
 * by coincidence — both are plain Int64 counters. Attaching an office logo to a house because two
 * unrelated keys collide is the failure this guards.
 *
 * `ResourceName` is `Lookup`-backed and its exact values are unknown (#162), so the test is a
 * substring rather than an equality. An ABSENT `ResourceName` is accepted: the field is nullable,
 * and rejecting on absence would drop every photo if this feed leaves it unset.
 */
function isPropertyResource(value: unknown): boolean {
  const raw = text(value);
  return raw === null || /propert/i.test(raw);
}

/** Whether the URL's path ends in an image extension. Query and fragment are ignored. */
function hasImageExtension(url: string): boolean {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    // Not absolute. Strip the query and fragment by hand and test what is left.
    path = url.split(/[?#]/)[0] ?? url;
  }
  return IMAGE_EXTENSION.test(path);
}

export function mapBrightMediaRecord(
  payload: Readonly<Record<string, unknown>>,
): BrightMediaMapResult {
  const sourceMediaKey = keyText(payload.MediaKey);
  if (sourceMediaKey === null) {
    return { kind: 'rejected', reason: 'missing_media_key' };
  }

  const listingKey = keyText(payload.ResourceRecordKey);
  if (listingKey === null) {
    return { kind: 'rejected', reason: 'missing_listing_link' };
  }

  if (!isPropertyResource(payload.ResourceName)) {
    return { kind: 'rejected', reason: 'wrong_resource' };
  }

  // `MediaURL` only. The feed also carries Thumb, Medium, HD, HiRes and Full variants, and picking
  // one of those as a fallback would serve a thumbnail into a full-width gallery. A record with no
  // `MediaURL` is a record with no image to show.
  const url = text(payload.MediaURL);
  if (url === null) {
    return { kind: 'rejected', reason: 'missing_url' };
  }

  const mimeType = text(payload.MediaType);
  if (mimeType !== null) {
    if (!IMAGE_MIME.test(mimeType)) {
      return { kind: 'rejected', reason: 'not_a_photo' };
    }
  } else if (!hasImageExtension(url)) {
    // Neither signal says image. Rejected rather than displayed, and counted under its own reason
    // so "the feed stopped sending MediaType" is distinguishable from "the feed sent a PDF".
    return { kind: 'rejected', reason: 'unknown_media_type' };
  }

  return {
    kind: 'mapped',
    media: {
      listingKey,
      sourceMediaKey,
      url,
      // Both are feed-authored free text and both routinely carry the street line. They are safe to
      // store because `applyAddressSuppression()` nulls `altText` at the response boundary on an
      // address-suppressed listing (#105). `caption` is stored and not yet served.
      altText: text(payload.MediaShortDescription),
      caption: text(payload.MediaLongDescription),
      displayOrder: order(payload.MediaDisplayOrder),
      preferred: payload.PreferredPhotoYN === true,
      mediaKeySort: BigInt(sourceMediaKey),
    },
  };
}

/** The total order described in the header. Exported so a test can assert it directly. */
export function compareGalleryOrder(a: MappedBrightMedia, b: MappedBrightMedia): number {
  if (a.preferred !== b.preferred) {
    return a.preferred ? -1 : 1;
  }
  const left = a.displayOrder;
  const right = b.displayOrder;
  if (left !== right) {
    if (left === null) {
      return 1;
    }
    if (right === null) {
      return -1;
    }
    return left - right;
  }
  if (a.mediaKeySort === b.mediaKeySort) {
    return 0;
  }
  return a.mediaKeySort < b.mediaKeySort ? -1 : 1;
}

/**
 * Orders one listing's accepted media and marks the primary image.
 *
 * Returns a new array. The input is not sorted in place, so a caller can keep the staged order for
 * a report. An empty input returns an empty array, never a row with no image.
 */
export function buildListingGallery(media: readonly MappedBrightMedia[]): GalleryEntry[] {
  return [...media]
    .sort(compareGalleryOrder)
    .map((entry, index) => ({ ...entry, sortOrder: index, isPrimary: index === 0 }));
}
