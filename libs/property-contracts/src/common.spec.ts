import {
  AMENITIES,
  amenitySchema,
  ATTRIBUTION_KEYS,
  attributionSchema,
  mediaSchema,
} from './common';

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
