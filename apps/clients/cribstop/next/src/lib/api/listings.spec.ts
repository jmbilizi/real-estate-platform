import { aListingDetail } from '@/test/fixtures';
import { toListingDetailView, toSearchParams } from './listings';

describe('toListingDetailView', () => {
  it('treats unit === null as a non-subdivided home, not an error or a loading state', () => {
    const view = toListingDetailView(aListingDetail({ unit: null }));

    expect(view.isSubdivided).toBe(false);
    expect(view.unitId).toBeNull();
    expect(view.unitNumber).toBeNull();
    // Resolution is exactly one level: with no unit, the subject is the property itself.
    expect(view.subjectId).toBe(view.propertyId);
  });

  it('resolves the subject to the unit for a subdivided building', () => {
    const view = toListingDetailView(
      aListingDetail({
        unit: {
          id: '55555555-5555-4555-8555-555555555555',
          unitNumber: 'PH1',
          beds: 2,
          baths: 2,
          sqft: 1400,
        },
      }),
    );

    expect(view.isSubdivided).toBe(true);
    expect(view.unitNumber).toBe('PH1');
    expect(view.subjectId).toBe('55555555-5555-4555-8555-555555555555');
    expect(view.subjectId).not.toBe(view.propertyId);
  });

  it('keeps the listing id distinct from the property id', () => {
    const view = toListingDetailView(aListingDetail());
    expect(view.id).not.toBe(view.propertyId);
  });

  it('flags a parcel so the detail page can suppress the dwelling stat block', () => {
    const view = toListingDetailView(
      aListingDetail({
        property: { propertyType: 'Land', yearBuilt: null, lotSqft: 104544 },
        listing: { propertyType: 'Land', beds: null, baths: null, sqft: null, lotSqft: 104544 },
      }),
    );

    expect(view.isParcel).toBe(true);
    expect(view.beds).toBeNull();
    expect(view.baths).toBeNull();
    expect(view.sqft).toBeNull();
  });

  it('does not re-source a suppressed value from the durable property facts', () => {
    // The seller withheld the year built on the advertisement; the durable site record still has
    // it. Re-sourcing it would hand back exactly the field that was suppressed.
    const view = toListingDetailView(
      aListingDetail({
        property: { yearBuilt: 1994, lotSqft: 6000 },
        listing: { yearBuilt: null, lotSqft: null },
      }),
    );

    expect(view.yearBuilt).toBeNull();
    expect(view.lotSqft).toBeNull();
  });

  it('carries detail-only fields through', () => {
    const view = toListingDetailView(
      aListingDetail({
        listing: {
          description: 'Sunny corner unit.',
          media: [
            { url: 'https://example.com/1.jpg', altText: 'Living room' },
            { url: 'https://example.com/2.jpg', altText: null },
          ],
          openHouses: [
            {
              startsAt: '2026-09-01T15:00:00.000Z',
              endsAt: '2026-09-01T17:00:00.000Z',
              remarks: null,
            },
          ],
        },
      }),
    );

    expect(view.description).toBe('Sunny corner unit.');
    expect(view.media).toHaveLength(2);
    expect(view.openHouses).toHaveLength(1);
  });

  it('renders listedBy as delivered rather than reassembling it', () => {
    const view = toListingDetailView(
      aListingDetail({ listing: { listedBy: 'Jane Doe – Real Broker, LLC' } }),
    );
    expect(view.listedBy).toBe('Jane Doe – Real Broker, LLC');
  });
});

describe('toSearchParams', () => {
  it('serializes numbers, booleans and enums into the forms the contract parses', () => {
    const params = toSearchParams({
      minPrice: 250000,
      baths: 2.5,
      openHouse: true,
      newConstruction: false,
      listingType: 'sale',
      page: 3,
    });

    expect(params.get('minPrice')).toBe('250000');
    expect(params.get('baths')).toBe('2.5');
    expect(params.get('openHouse')).toBe('true');
    expect(params.get('newConstruction')).toBe('false');
    expect(params.get('listingType')).toBe('sale');
    expect(params.get('page')).toBe('3');
  });

  it('repeats amenities rather than joining them', () => {
    expect(toSearchParams({ amenities: ['Pool', 'Garage'] }).getAll('amenities')).toEqual([
      'Pool',
      'Garage',
    ]);
  });

  it('omits undefined and empty values so the API is not asked to parse a blank', () => {
    const params = toSearchParams({ query: undefined, neighborhood: '', beds: 3 });
    expect(params.has('query')).toBe(false);
    expect(params.has('neighborhood')).toBe(false);
    expect(params.get('beds')).toBe('3');
  });
});
