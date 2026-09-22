import { Queryable } from '../../db/write';

import { mapStagedBrightMedia } from './run';

interface MediaRowState {
  listing_id: string;
  source_media_key: string | null;
  source_url: string;
  alt_text: string | null;
  caption: string | null;
  sort_order: number;
  is_primary: boolean;
  retained_when_suppressed: boolean;
  is_sample: boolean;
}

/**
 * An in-memory stand-in for the three statements `replaceFeedListingMedia()` issues, plus the two
 * reads `mapStagedBrightMedia()` does. It recognises statements by substring, like `run.spec.ts`.
 *
 * It enforces the ONE database rule these tests are really about: at most one `is_primary` row per
 * listing, which `idx_listing_media_one_primary` enforces for real. Without that check the
 * statement ordering inside the writer would be untested, and reordering a gallery is exactly what
 * breaks it.
 */
function createFakeDb(options: {
  stagedPayloads: unknown[];
  listings: { key: string; id: string; isSample?: boolean }[];
  seededMedia?: MediaRowState[];
}): { client: Queryable; media: () => MediaRowState[] } {
  const media: MediaRowState[] = [...(options.seededMedia ?? [])];

  function assertOnePrimary(listingId: string): void {
    const primaries = media.filter((row) => row.listing_id === listingId && row.is_primary);
    if (primaries.length > 1) {
      throw new Error(
        `idx_listing_media_one_primary violated: ${primaries.length} primary rows on ${listingId}`,
      );
    }
  }

  const client: Queryable = {
    query: async (text: string, values: unknown[] = []) => {
      if (text.includes('FROM bright_staging_records')) {
        return { rows: options.stagedPayloads.map((payload) => ({ payload })) };
      }

      if (text.includes('FROM listings')) {
        const wanted = new Set((values[1] as string[]) ?? []);
        return {
          rows: options.listings
            .filter((listing) => wanted.has(listing.key))
            .map((listing) => ({
              id: listing.id,
              source_listing_key: listing.key,
              is_sample: listing.isSample ?? false,
            })),
        };
      }

      if (text.includes('UPDATE listing_media SET is_primary = false')) {
        const [listingId] = values as [string];
        for (const row of media) {
          if (row.listing_id === listingId) {
            row.is_primary = false;
          }
        }
        return { rows: [] };
      }

      if (text.includes('INSERT INTO listing_media')) {
        const [
          ,
          listingId,
          sourceMediaKey,
          sourceUrl,
          altText,
          caption,
          sortOrder,
          isPrimary,
          isSample,
        ] = values as [
          string,
          string,
          string,
          string,
          string | null,
          string | null,
          number,
          boolean,
          boolean,
        ];
        const existing = media.find(
          (row) => row.listing_id === listingId && row.source_media_key === sourceMediaKey,
        );
        if (existing) {
          Object.assign(existing, {
            source_url: sourceUrl,
            alt_text: altText,
            caption,
            sort_order: sortOrder,
            is_primary: isPrimary,
            is_sample: isSample,
            // Deliberately NOT updated, matching the DO UPDATE list in write.ts.
          });
        } else {
          media.push({
            listing_id: listingId,
            source_media_key: sourceMediaKey,
            source_url: sourceUrl,
            alt_text: altText,
            caption,
            sort_order: sortOrder,
            is_primary: isPrimary,
            retained_when_suppressed: false,
            is_sample: isSample,
          });
        }
        assertOnePrimary(listingId);
        return { rows: [] };
      }

      if (text.includes('DELETE FROM listing_media')) {
        const [listingId, keep] = values as [string, string[]];
        const kept = new Set(keep);
        for (let index = media.length - 1; index >= 0; index -= 1) {
          const row = media[index];
          if (
            row !== undefined &&
            row.listing_id === listingId &&
            row.source_media_key !== null &&
            !kept.has(row.source_media_key)
          ) {
            media.splice(index, 1);
          }
        }
        return { rows: [] };
      }

      throw new Error(`unexpected statement: ${text.slice(0, 80)}`);
    },
  };

  return { client, media: () => media };
}

function photo(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    MediaKey: 1,
    ResourceRecordKey: 900100,
    ResourceName: 'Property',
    MediaURL: 'https://cdn.brightmls.com/1.jpg',
    MediaType: 'image/jpeg',
    MediaDisplayOrder: 1,
    ...overrides,
  };
}

describe('mapStagedBrightMedia', () => {
  it('reports zero work and writes nothing when no media is staged', async () => {
    const { client, media } = createFakeDb({ stagedPayloads: [], listings: [] });
    const report = await mapStagedBrightMedia(client);
    expect(report.staged).toBe(0);
    expect(report.mediaWritten).toBe(0);
    expect(media()).toEqual([]);
  });

  it('writes a listing gallery in the feed order, with one primary', async () => {
    const { client, media } = createFakeDb({
      stagedPayloads: [
        photo({ MediaKey: 1, MediaDisplayOrder: 3 }),
        photo({ MediaKey: 2, MediaDisplayOrder: 1 }),
        photo({ MediaKey: 3, MediaDisplayOrder: 2, PreferredPhotoYN: true }),
      ],
      listings: [{ key: '900100', id: 'listing-a' }],
    });

    const report = await mapStagedBrightMedia(client);

    expect(report).toMatchObject({
      staged: 3,
      mapped: 3,
      rejected: 0,
      unmatchedMedia: 0,
      listingsWithMedia: 1,
      listingsWithNoMedia: 0,
      mediaWritten: 3,
    });
    // Rows arrive in gallery order: the preferred photo, then by MediaDisplayOrder.
    expect(media().map((row) => [row.source_media_key, row.sort_order, row.is_primary])).toEqual([
      ['3', 0, true],
      ['2', 1, false],
      ['1', 2, false],
    ]);
  });

  it('never sets retained_when_suppressed, which stays #146 mechanism', async () => {
    const { client, media } = createFakeDb({
      stagedPayloads: [photo()],
      listings: [{ key: '900100', id: 'listing-a' }],
    });
    await mapStagedBrightMedia(client);
    expect(media().every((row) => row.retained_when_suppressed === false)).toBe(true);
  });

  it('carries is_sample from the listing, so a sample listing’s photos are swept with it', async () => {
    const { client, media } = createFakeDb({
      stagedPayloads: [photo()],
      listings: [{ key: '900100', id: 'listing-a', isSample: true }],
    });
    await mapStagedBrightMedia(client);
    expect(media()[0]?.is_sample).toBe(true);
  });

  it('drops media whose listing this service does not hold, and counts it', async () => {
    const { client, media } = createFakeDb({
      stagedPayloads: [photo({ MediaKey: 1 }), photo({ MediaKey: 2, ResourceRecordKey: 777 })],
      listings: [{ key: '900100', id: 'listing-a' }],
    });

    const report = await mapStagedBrightMedia(client);

    expect(report.unmatchedMedia).toBe(1);
    expect(report.mediaWritten).toBe(1);
    expect(media()).toHaveLength(1);
  });

  it('counts rejections by reason instead of writing a guessed row', async () => {
    const { client, media } = createFakeDb({
      stagedPayloads: [
        photo({ MediaKey: 1 }),
        photo({ MediaKey: 2, MediaURL: null }),
        photo({ MediaKey: 3, MediaType: 'application/pdf' }),
        photo({ MediaKey: 4, ResourceRecordKey: null }),
      ],
      listings: [{ key: '900100', id: 'listing-a' }],
    });

    const report = await mapStagedBrightMedia(client);

    expect(report.rejected).toBe(3);
    expect(report.rejectedByReason).toEqual({
      missing_url: 1,
      not_a_photo: 1,
      missing_listing_link: 1,
    });
    expect(media()).toHaveLength(1);
  });

  it('is idempotent: a second pass over the same batch changes nothing', async () => {
    const staged = [photo({ MediaKey: 1 }), photo({ MediaKey: 2, MediaDisplayOrder: 2 })];
    const { client, media } = createFakeDb({
      stagedPayloads: staged,
      listings: [{ key: '900100', id: 'listing-a' }],
    });

    await mapStagedBrightMedia(client);
    const first = JSON.stringify(media());
    await mapStagedBrightMedia(client);

    expect(JSON.stringify(media())).toBe(first);
    expect(media()).toHaveLength(2);
  });

  it('reorders a gallery without violating the one-primary index', async () => {
    // The fake throws when two primaries coexist, so this passing IS the ordering assertion.
    const { client, media } = createFakeDb({
      stagedPayloads: [photo({ MediaKey: 1, MediaDisplayOrder: 1 })],
      listings: [{ key: '900100', id: 'listing-a' }],
      seededMedia: [
        {
          listing_id: 'listing-a',
          source_media_key: '9',
          source_url: 'https://cdn.brightmls.com/9.jpg',
          alt_text: null,
          caption: null,
          sort_order: 0,
          is_primary: true,
          retained_when_suppressed: false,
          is_sample: false,
        },
      ],
    });

    await mapStagedBrightMedia(client);

    expect(
      media()
        .filter((row) => row.is_primary)
        .map((row) => row.source_media_key),
    ).toEqual(['1']);
  });

  it('removes a photo the feed no longer carries', async () => {
    const { client, media } = createFakeDb({
      stagedPayloads: [photo({ MediaKey: 1 })],
      listings: [{ key: '900100', id: 'listing-a' }],
      seededMedia: [
        {
          listing_id: 'listing-a',
          source_media_key: 'withdrawn',
          source_url: 'https://cdn.brightmls.com/gone.jpg',
          alt_text: null,
          caption: null,
          sort_order: 5,
          is_primary: false,
          retained_when_suppressed: false,
          is_sample: false,
        },
      ],
    });

    await mapStagedBrightMedia(client);

    expect(media().map((row) => row.source_media_key)).toEqual(['1']);
  });

  it('leaves a photo with no source_media_key alone, so seeded media survives', async () => {
    const seeded: MediaRowState = {
      listing_id: 'listing-a',
      source_media_key: null,
      source_url: 'https://cdn.example.com/seeded.jpg',
      alt_text: 'Seeded',
      caption: null,
      sort_order: 0,
      is_primary: false,
      retained_when_suppressed: false,
      is_sample: true,
    };
    const { client, media } = createFakeDb({
      stagedPayloads: [photo()],
      listings: [{ key: '900100', id: 'listing-a' }],
      seededMedia: [seeded],
    });

    await mapStagedBrightMedia(client);

    expect(media()).toContainEqual(seeded);
  });

  it('carries the feed caption onto alt_text, which the address boundary can then withhold', async () => {
    const { client, media } = createFakeDb({
      stagedPayloads: [photo({ MediaShortDescription: 'Front elevation, 123 Maple St' })],
      listings: [{ key: '900100', id: 'listing-a' }],
    });
    await mapStagedBrightMedia(client);
    expect(media()[0]?.alt_text).toBe('Front elevation, 123 Maple St');
  });
});
