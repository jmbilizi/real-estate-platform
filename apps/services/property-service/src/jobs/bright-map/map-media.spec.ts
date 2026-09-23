import {
  buildListingGallery,
  compareGalleryOrder,
  mapBrightMediaRecord,
  type MappedBrightMedia,
} from './map-media';

/** A record that maps cleanly. Each test overrides only the field it is about. */
function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    MediaKey: 5001,
    ResourceRecordKey: 900100,
    ResourceName: 'Property',
    MediaURL: 'https://cdn.brightmls.com/photo/5001.jpg',
    MediaType: 'image/jpeg',
    MediaDisplayOrder: 1,
    PreferredPhotoYN: false,
    ...overrides,
  };
}

function mapped(overrides: Record<string, unknown> = {}): MappedBrightMedia {
  const result = mapBrightMediaRecord(record(overrides));
  if (result.kind !== 'mapped') {
    throw new Error(`expected a mapped record, got rejected: ${result.reason}`);
  }
  return result.media;
}

function rejection(overrides: Record<string, unknown>): string {
  const result = mapBrightMediaRecord(record(overrides));
  return result.kind === 'rejected' ? result.reason : 'MAPPED';
}

describe('mapBrightMediaRecord', () => {
  it('maps the feed fields named in the metadata document', () => {
    expect(
      mapped({
        MediaShortDescription: 'Front elevation',
        MediaLongDescription: 'Front elevation seen from the street',
        PreferredPhotoYN: true,
        MediaDisplayOrder: 3,
      }),
    ).toEqual({
      listingKey: '900100',
      sourceMediaKey: '5001',
      url: 'https://cdn.brightmls.com/photo/5001.jpg',
      altText: 'Front elevation',
      caption: 'Front elevation seen from the street',
      displayOrder: 3,
      preferred: true,
      mediaKeySort: 5001n,
    });
  });

  it('accepts an Int64 key sent as a string', () => {
    expect(mapped({ MediaKey: '9007199254740993' }).sourceMediaKey).toBe('9007199254740993');
  });

  it('carries no alt text or caption when the feed sends none', () => {
    const media = mapped({});
    expect(media.altText).toBeNull();
    expect(media.caption).toBeNull();
  });

  it('treats a blank description as absent rather than as an empty accessible name', () => {
    expect(mapped({ MediaShortDescription: '   ' }).altText).toBeNull();
  });

  it('reads PreferredPhotoYN only on a literal true, matching the suppression mapper', () => {
    expect(mapped({ PreferredPhotoYN: 'Y' }).preferred).toBe(false);
    expect(mapped({ PreferredPhotoYN: 1 }).preferred).toBe(false);
    expect(mapped({ PreferredPhotoYN: true }).preferred).toBe(true);
  });

  it('reports an absent display order as null, not as zero', () => {
    // Zero is a real Bright order value and must not collide with "unknown".
    expect(mapped({ MediaDisplayOrder: undefined }).displayOrder).toBeNull();
    expect(mapped({ MediaDisplayOrder: 0 }).displayOrder).toBe(0);
  });

  describe('rejections', () => {
    it.each([
      ['missing_media_key', { MediaKey: null }],
      ['missing_media_key', { MediaKey: 1.5 }],
      ['missing_listing_link', { ResourceRecordKey: null }],
      ['missing_listing_link', { ResourceRecordKey: '' }],
      ['missing_url', { MediaURL: null }],
      ['missing_url', { MediaURL: '   ' }],
      ['not_a_photo', { MediaType: 'application/pdf' }],
      ['not_a_photo', { MediaType: 'video/mp4' }],
      ['wrong_resource', { ResourceName: 'Office' }],
      ['wrong_resource', { ResourceName: 'Member' }],
    ])('rejects with %s', (reason, overrides) => {
      expect(rejection(overrides)).toBe(reason);
    });

    it("accepts the production feed's bare subtype and its Photo category", () => {
      // Measured 2026-09-23: `MediaType: "jpeg"`, `MediaCategory: "Photo"`, no `image/` prefix.
      expect(rejection({ MediaType: 'jpeg' })).toBe('MAPPED');
      expect(rejection({ MediaType: 'PNG' })).toBe('MAPPED');
      expect(rejection({ MediaType: 'unknown', MediaCategory: 'Photo' })).toBe('MAPPED');
      expect(rejection({ MediaType: 'pdf', MediaCategory: 'Document' })).toBe('not_a_photo');
    });

    it('falls back to the URL extension when the feed sends no mime type', () => {
      expect(rejection({ MediaType: null })).toBe('MAPPED');
      expect(rejection({ MediaType: null, MediaURL: 'https://cdn.example.com/a.png?v=2' })).toBe(
        'MAPPED',
      );
    });

    it('rejects when neither the mime type nor the URL says image', () => {
      expect(rejection({ MediaType: null, MediaURL: 'https://cdn.example.com/tour' })).toBe(
        'unknown_media_type',
      );
      expect(rejection({ MediaType: null, MediaURL: 'https://cdn.example.com/doc.pdf' })).toBe(
        'unknown_media_type',
      );
    });

    it('lets a stated mime type override the URL extension', () => {
      // A `.jpg` path with a PDF mime type is a photo by neither reading. The mime wins.
      expect(rejection({ MediaType: 'application/pdf', MediaURL: 'https://x.test/a.jpg' })).toBe(
        'not_a_photo',
      );
    });

    it('accepts an absent ResourceName, because the field is nullable on this feed', () => {
      expect(rejection({ ResourceName: null })).toBe('MAPPED');
    });
  });
});

describe('buildListingGallery', () => {
  /** Builds a mapped record directly, so an ordering test does not restate the field mapping. */
  function entry(
    sourceMediaKey: string,
    displayOrder: number | null,
    preferred = false,
  ): MappedBrightMedia {
    return {
      listingKey: '900100',
      sourceMediaKey,
      url: `https://cdn.example.com/${sourceMediaKey}.jpg`,
      altText: null,
      caption: null,
      displayOrder,
      preferred,
      mediaKeySort: BigInt(sourceMediaKey),
    };
  }

  function keys(media: readonly MappedBrightMedia[]): string[] {
    return buildListingGallery(media).map((item) => item.sourceMediaKey);
  }

  it('puts the preferred photo first, whatever its display order', () => {
    const gallery = buildListingGallery([entry('1', 1), entry('2', 9, true), entry('3', 2)]);
    expect(gallery.map((item) => item.sourceMediaKey)).toEqual(['2', '1', '3']);
    expect(gallery[0]?.isPrimary).toBe(true);
  });

  it('orders by display order when no photo is preferred', () => {
    expect(keys([entry('7', 3), entry('8', 1), entry('9', 2)])).toEqual(['8', '9', '7']);
  });

  it('sorts an absent display order last, never first', () => {
    expect(keys([entry('1', null), entry('2', 5)])).toEqual(['2', '1']);
  });

  it('breaks a tie by MediaKey numerically, not as text', () => {
    // '10' precedes '9' as text. The order must be numeric, or the gallery reshuffles per run.
    expect(keys([entry('10', 1), entry('9', 1)])).toEqual(['9', '10']);
  });

  it('resolves two preferred photos deterministically instead of failing', () => {
    expect(keys([entry('4', 2, true), entry('3', 1, true)])).toEqual(['3', '4']);
  });

  it('marks exactly one primary and numbers sort_order from zero', () => {
    const gallery = buildListingGallery([entry('1', 2), entry('2', 1), entry('3', 3)]);
    expect(gallery.filter((item) => item.isPrimary)).toHaveLength(1);
    expect(gallery.map((item) => item.sortOrder)).toEqual([0, 1, 2]);
  });

  it('is stable across input orderings', () => {
    const input = [entry('5', 2), entry('6', null), entry('7', 1, true), entry('8', 2)];
    expect(keys(input)).toEqual(keys([...input].reverse()));
  });

  it('returns an empty gallery for no media, rather than a row with no image', () => {
    expect(buildListingGallery([])).toEqual([]);
  });

  it('does not sort its input in place', () => {
    const input = [entry('2', 2), entry('1', 1)];
    buildListingGallery(input);
    expect(input.map((item) => item.sourceMediaKey)).toEqual(['2', '1']);
  });
});

describe('compareGalleryOrder', () => {
  it('reports equality only for the same position', () => {
    const one: MappedBrightMedia = {
      listingKey: '1',
      sourceMediaKey: '1',
      url: 'https://x.test/1.jpg',
      altText: null,
      caption: null,
      displayOrder: 1,
      preferred: false,
      mediaKeySort: 1n,
    };
    expect(compareGalleryOrder(one, one)).toBe(0);
    expect(
      compareGalleryOrder(one, { ...one, sourceMediaKey: '2', mediaKeySort: 2n }),
    ).toBeLessThan(0);
  });
});
