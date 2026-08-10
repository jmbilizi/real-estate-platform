import { AMENITIES, amenitySchema, attributionSchema, mediaSchema } from './common';

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
});
