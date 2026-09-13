import { applyAddressSuppression, applyCardAddressSuppression } from './suppression';
import { cardFixture, detailFixture } from './test-fixtures';

const OPEN_HOUSE = {
  startsAt: '2026-08-15T14:00:00.000Z',
  endsAt: '2026-08-15T16:00:00.000Z',
  // The shape of remarks that makes this a leak rather than a nicety: a real cross street and a
  // real house number, which is how showing instructions are actually written.
  remarks: 'Park on Oak; entrance at the rear of 142 Oak St.',
} as const;

/**
 * The shape of alt text that makes this a leak rather than a nicety. MLS photo captions are written
 * exactly like this — a subject followed by the street line — which is why #105 exists.
 */
const LEAKY_ALT_TEXT = 'Front elevation of 142 Oak St, seen from the street';
const MEDIA = { url: 'https://cdn.example/photo-1.jpg', altText: LEAKY_ALT_TEXT } as const;

describe('applyAddressSuppression', () => {
  it('nulls unit.unitNumber when the view masked the address', () => {
    // The view builds address as `street_line || ' ' || unit_number`, so emitting the unit number
    // next to city/state/zip makes an opted-out condo's address reconstructible.
    const detail = detailFixture({ address: null, unitNumber: '4B' });
    expect(applyAddressSuppression(detail).unit?.unitNumber).toBeNull();
  });

  it('leaves the unit number alone when the address was published', () => {
    const detail = detailFixture({ address: '900 King St 4B', unitNumber: '4B' });
    expect(applyAddressSuppression(detail).unit?.unitNumber).toBe('4B');
  });

  it('is a no-op for a non-subdivided home', () => {
    const detail = detailFixture({ address: null, unitNumber: null, unit: null });
    expect(applyAddressSuppression(detail).unit).toBeNull();
  });

  describe('open-house remarks (#59)', () => {
    it('nulls the remarks on every occurrence when the view masked the address', () => {
      // The view masks the one upcoming occurrence it projects, but the detail response's
      // openHouses[] array comes from getListingById()'s own json_agg over listing_open_houses —
      // a query that never passes through the view. Without this the detail endpoint republishes,
      // verbatim, the street line the view masked three fields above it.
      const detail = detailFixture({
        address: null,
        openHouses: [OPEN_HOUSE, { ...OPEN_HOUSE, remarks: 'Second showing, 142 Oak St rear.' }],
      });

      const suppressed = applyAddressSuppression(detail);

      expect(suppressed.listing.openHouses).toHaveLength(2);
      for (const openHouse of suppressed.listing.openHouses) {
        expect(openHouse.remarks).toBeNull();
      }
    });

    it('keeps the occurrence TIMES, because a time does not identify an address', () => {
      // The opt-out is a mask on display, not a removal from the market. Dropping the showing a
      // consumer could walk into would suppress inventory, not an address.
      const detail = detailFixture({ address: null, openHouses: [OPEN_HOUSE] });

      const [occurrence] = applyAddressSuppression(detail).listing.openHouses;

      expect(occurrence?.startsAt).toBe(OPEN_HOUSE.startsAt);
      expect(occurrence?.endsAt).toBe(OPEN_HOUSE.endsAt);
    });

    it('leaves the remarks alone when the address was published', () => {
      const detail = detailFixture({ address: '900 King St 4B', openHouses: [OPEN_HOUSE] });

      const [occurrence] = applyAddressSuppression(detail).listing.openHouses;

      expect(occurrence?.remarks).toBe(OPEN_HOUSE.remarks);
    });

    it('suppresses the remarks even on a non-subdivided home, which has no unit to mask', () => {
      // Regression guard: the pre-#59 implementation returned early on `unit === null`, so folding
      // the remarks in under that branch would have skipped them for every single-family listing —
      // the majority of inventory.
      const detail = detailFixture({ address: null, unit: null, openHouses: [OPEN_HOUSE] });

      const [occurrence] = applyAddressSuppression(detail).listing.openHouses;

      expect(occurrence?.remarks).toBeNull();
    });

    it('does not mutate the detail it was handed', () => {
      const detail = detailFixture({ address: null, openHouses: [OPEN_HOUSE] });

      applyAddressSuppression(detail);

      expect(detail.listing.openHouses[0]?.remarks).toBe(OPEN_HOUSE.remarks);
    });
  });

  describe('media alt text (#105)', () => {
    it('nulls the alt text on every media item when the view masked the address', () => {
      // media[] comes from getListingById()'s own json_agg over listing_media, which never passes
      // through listing_search_v — the same structural reason the open-house remarks are here.
      const detail = detailFixture({
        address: null,
        media: [
          MEDIA,
          { url: 'https://cdn.example/photo-2.jpg', altText: '142 Oak St, rear yard' },
        ],
      });

      const suppressed = applyAddressSuppression(detail);

      expect(suppressed.listing.media).toHaveLength(2);
      for (const item of suppressed.listing.media) {
        expect(item.altText).toBeNull();
      }
    });

    it('keeps the image URLs, because a URL is not an address', () => {
      // The opt-out masks the address, it does not withdraw the listing's photos from the market.
      const detail = detailFixture({ address: null, media: [MEDIA] });

      expect(applyAddressSuppression(detail).listing.media[0]?.url).toBe(MEDIA.url);
    });

    it('leaves the alt text alone when the address was published', () => {
      const detail = detailFixture({ address: '900 King St 4B', media: [MEDIA] });

      expect(applyAddressSuppression(detail).listing.media[0]?.altText).toBe(LEAKY_ALT_TEXT);
    });

    it('suppresses the alt text even on a non-subdivided home, which has no unit to mask', () => {
      // Same regression guard the remarks carry: folding this under the pre-#59 `unit === null`
      // early return would skip it for the majority of inventory.
      const detail = detailFixture({ address: null, unit: null, media: [MEDIA] });

      expect(applyAddressSuppression(detail).listing.media[0]?.altText).toBeNull();
    });

    it('does not mutate the detail it was handed', () => {
      const detail = detailFixture({ address: null, media: [MEDIA] });

      applyAddressSuppression(detail);

      expect(detail.listing.media[0]?.altText).toBe(LEAKY_ALT_TEXT);
    });
  });
});

describe('applyCardAddressSuppression (#105)', () => {
  it("nulls primaryMedia.altText when the view masked the card's address", () => {
    // The card path had no response boundary at all before #105: searchListings() relied entirely
    // on listing_search_v, which is correct for every field the view projects — and primaryMedia is
    // joined in from listing_media ALONGSIDE the view, not through it.
    const card = cardFixture({ address: null, primaryMedia: MEDIA });

    expect(applyCardAddressSuppression(card).primaryMedia?.altText).toBeNull();
  });

  it('keeps the image URL', () => {
    const card = cardFixture({ address: null, primaryMedia: MEDIA });

    expect(applyCardAddressSuppression(card).primaryMedia?.url).toBe(MEDIA.url);
  });

  it('leaves the alt text alone when the address was published', () => {
    const card = cardFixture({ address: '900 King St', primaryMedia: MEDIA });

    expect(applyCardAddressSuppression(card).primaryMedia?.altText).toBe(LEAKY_ALT_TEXT);
  });

  it('is a no-op for a suppressed card with no media at all', () => {
    const card = cardFixture({ address: null, primaryMedia: null });

    expect(applyCardAddressSuppression(card).primaryMedia).toBeNull();
  });

  it('does not mutate the card it was handed', () => {
    const card = cardFixture({ address: null, primaryMedia: MEDIA });

    applyCardAddressSuppression(card);

    expect(card.primaryMedia?.altText).toBe(LEAKY_ALT_TEXT);
  });
});
