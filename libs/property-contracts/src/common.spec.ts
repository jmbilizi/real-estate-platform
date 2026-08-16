import {
  AMENITIES,
  amenitySchema,
  ATTRIBUTION_KEYS,
  attributionSchema,
  LISTING_SOURCES,
  LISTING_TYPES,
  mediaSchema,
  PROPERTY_TYPES,
} from './common';
import type { Amenity, ListingSource, ListingType, PropertyType } from './common';

describe('common schemas', () => {
  it('locks the amenity set to the 15 values the database CHECK allows', () => {
    expect([...AMENITIES]).toEqual([
      'Pool',
      'Garage',
      'Gym',
      'Elevator',
      'Balcony',
      'Fireplace',
      'Washer/Dryer',
      'Pet Friendly',
      'Waterfront',
      'Office',
      'Rooftop',
      'Garden',
      'Smart Home',
      'Solar',
      'EV Charging',
    ]);
  });

  it('rejects an amenity outside the closed set', () => {
    expect(amenitySchema.safeParse('Helipad').success).toBe(false);
  });

  it('requires alt text to be present on media, even when null', () => {
    expect(mediaSchema.safeParse({ url: 'https://x/y.jpg' }).success).toBe(false);
    expect(mediaSchema.safeParse({ url: 'https://x/y.jpg', altText: null }).success).toBe(true);
  });

  it('keeps every attribution key present (NAR 7.58)', () => {
    const parsed = attributionSchema.parse({
      listingAgentName: null,
      brokerName: 'B',
      brokerPhone: '1',
      brokerEmail: 'agent@brokerco.com',
      officeName: 'O',
      officeBrokerLeadPhone: null,
      officeBrokerLeadEmail: null,
      listedBy: 'B – O',
    });
    expect(Object.keys(parsed).sort()).toEqual([
      'brokerEmail',
      'brokerName',
      'brokerPhone',
      'listedBy',
      'listingAgentName',
      'officeBrokerLeadEmail',
      'officeBrokerLeadPhone',
      'officeName',
    ]);
  });

  // ATTRIBUTION_KEYS is derived from attributionSchema.shape (`Object.keys(...)`), so asserting it
  // against itself — or against anything else derived from attributionSchema, like
  // ListingCardRow's OpenAPI properties — is circular: deleting a key shrinks both sides at once
  // and the assertion still passes. This is the one place the eight names are hard-coded
  // independently of the schema, so a key removed from attributionSchema is caught here even if
  // every downstream derivation quietly shrinks to match (#47 review round 2, finding 1).
  it('pins ATTRIBUTION_KEYS to exactly the eight NAR 7.58 names, not whatever attributionSchema currently declares', () => {
    expect(ATTRIBUTION_KEYS).toHaveLength(8);
    expect([...ATTRIBUTION_KEYS].sort()).toEqual([
      'brokerEmail',
      'brokerName',
      'brokerPhone',
      'listedBy',
      'listingAgentName',
      'officeBrokerLeadEmail',
      'officeBrokerLeadPhone',
      'officeName',
    ]);
  });
});

/**
 * The exported enum types are what `cribstop-next` types its filter controls and its
 * `source`-driven provenance condition against. A type-only export is invisible to a runtime
 * assertion, so each one is exercised here by assigning a value through it: if the type is dropped
 * or its union narrows, this file stops compiling under `nx type-check`, which is the signal.
 */
describe('exported enum types stay in step with their value sets', () => {
  it('accepts every declared listing type and nothing else', () => {
    const all: ListingType[] = [...LISTING_TYPES];
    expect(all).toHaveLength(LISTING_TYPES.length);
    // @ts-expect-error — 'lease' is not a listing type, and the type must be what rejects it.
    const invalid: ListingType = 'lease';
    expect(invalid).toBe('lease');
  });

  it('accepts every declared property type', () => {
    const all: PropertyType[] = [...PROPERTY_TYPES];
    expect(all).toContain('Land');
  });

  it('accepts every declared amenity', () => {
    const all: Amenity[] = [...AMENITIES];
    expect(all).toContain('Pet Friendly');
  });

  it('accepts every declared source, which is what per-listing provenance branches on', () => {
    const all: ListingSource[] = [...LISTING_SOURCES];
    expect(all).toEqual(['brightMLS', 'internal', 'other']);
    // @ts-expect-error — an unlisted source must not type-check; provenance branches on this union.
    const invalid: ListingSource = 'mls';
    expect(invalid).toBe('mls');
  });
});
