import { toListingDetail } from './map-row';
import { cardDbRowFixture } from './test-fixtures';

describe('toListingDetail with bad feed values (#564)', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  const row = (overrides: Record<string, unknown>) =>
    cardDbRowFixture({
      tax_annual_amount: 5120.5,
      hoa_fee: 310,
      virtual_tour_url: 'https://tours.example/abc',
      list_agent_email: 'agent@example.com',
      facts: { heating: ['Forced Air'], parking: ['Driveway'] },
      media: [{ url: 'https://cdn.example/1.jpg', alt_text: 'Kitchen', caption: 'Kitchen' }],
      ...overrides,
    } as never);

  it.each(['not a url', 'javascript:alert(1)', 'ftp://tours.example/a', ''])(
    'nulls the tour URL %p and keeps the rest',
    (url) => {
      const { listing } = toListingDetail(row({ virtual_tour_url: url }));
      expect(listing.virtualTourUrl).toBeNull();
      expect(listing.taxAnnualAmount).toBe(5120.5);
      expect(listing.facts.heating).toEqual(['Forced Air']);
    },
  );

  it.each(['a b@@example', 'no-at-sign', 'agent @example.com'])(
    'nulls the agent email %p',
    (email) => {
      const { listing } = toListingDetail(row({ list_agent_email: email }));
      expect(listing.listAgentEmail).toBeNull();
      expect(listing.hoaFee).toBe(310);
    },
  );

  it('nulls a fact group of the wrong type and keeps the other groups', () => {
    const { listing } = toListingDetail(
      row({ facts: { heating: 'Forced Air', parking: ['Driveway', 7], cooling: ['Central'] } }),
    );
    expect(listing.facts.heating).toBeNull();
    expect(listing.facts.parking).toBeNull();
    expect(listing.facts.cooling).toEqual(['Central']);
  });

  it('drops a fact group the contract does not know', () => {
    const { listing } = toListingDetail(row({ facts: { keywords: ['Cozy'], heating: ['Gas'] } }));
    expect(listing.facts).not.toHaveProperty('keywords');
    expect(listing.facts.heating).toEqual(['Gas']);
  });

  it('nulls numbers of the wrong type, one field each', () => {
    const { listing } = toListingDetail(
      row({ tax_annual_amount: '5120.50', tax_year: 'FY25', hoa_fee: -5 }),
    );
    expect(listing.taxAnnualAmount).toBeNull();
    expect(listing.taxYear).toBeNull();
    expect(listing.hoaFee).toBeNull();
    expect(listing.virtualTourUrl).toBe('https://tours.example/abc');
  });

  it('nulls a caption of the wrong type and keeps the photo', () => {
    const { listing } = toListingDetail(
      row({ media: [{ url: 'https://cdn.example/1.jpg', alt_text: 'Kitchen', caption: 42 }] }),
    );
    expect(listing.media[0]).toEqual({
      url: 'https://cdn.example/1.jpg',
      altText: 'Kitchen',
      caption: null,
    });
  });

  it('logs the field names and never the values', () => {
    toListingDetail(row({ virtual_tour_url: 'not a url 142 Oak St' }));
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain('virtualTourUrl');
    expect(message).not.toContain('Oak');
  });

  it('still throws for a broken core field', () => {
    expect(() => toListingDetail(row({ title: null }))).toThrow();
  });
});
