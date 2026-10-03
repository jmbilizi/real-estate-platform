import { toListingCardRow, toListingDetail } from './map-row';
import { applyAddressSuppression } from './suppression';
import { cardDbRowFixture, detailFixture } from './test-fixtures';

describe('toListingDetail detail facts (#564)', () => {
  it('serves null for every absent fact and every absent caption', () => {
    const { listing } = toListingDetail(
      cardDbRowFixture({ media: [{ url: 'https://cdn.example/1.jpg', alt_text: null }] }),
    );

    expect(listing).toMatchObject({
      taxAnnualAmount: null,
      taxYear: null,
      hoaFee: null,
      hoaFeeFrequency: null,
      virtualTourUrl: null,
      listAgentPhone: null,
      listAgentEmail: null,
    });
    expect(Object.values(listing.facts).every((group) => group === null)).toBe(true);
    expect(listing.media[0]?.caption).toBeNull();
  });

  it('serves each present fact, and null for a group with no key', () => {
    const { listing } = toListingDetail(
      cardDbRowFixture({
        tax_annual_amount: 5120.5,
        tax_year: 2025,
        hoa_fee: 310,
        hoa_fee_frequency: 'Monthly',
        virtual_tour_url: 'https://tours.example/abc',
        list_agent_phone: '2025550100',
        list_agent_email: 'agent@example.com',
        facts: { heating: ['Forced Air'], parking: ['Driveway', 'Off Street'] },
        media: [
          { url: 'https://cdn.example/1.jpg', alt_text: 'Kitchen', caption: 'Updated kitchen' },
        ],
      }),
    );

    expect(listing).toMatchObject({
      taxAnnualAmount: 5120.5,
      taxYear: 2025,
      hoaFee: 310,
      hoaFeeFrequency: 'Monthly',
      virtualTourUrl: 'https://tours.example/abc',
      listAgentPhone: '2025550100',
      listAgentEmail: 'agent@example.com',
    });
    expect(listing.facts.heating).toEqual(['Forced Air']);
    expect(listing.facts.parking).toEqual(['Driveway', 'Off Street']);
    expect(listing.facts.cooling).toBeNull();
    expect(listing.media[0]).toEqual({
      url: 'https://cdn.example/1.jpg',
      altText: 'Kitchen',
      caption: 'Updated kitchen',
    });
  });

  it('keeps the detail facts off the card row', () => {
    const card = toListingCardRow(cardDbRowFixture({ tax_annual_amount: 5000, hoa_fee: 100 }));
    expect(card).not.toHaveProperty('taxAnnualAmount');
    expect(card).not.toHaveProperty('hoaFee');
    expect(card).not.toHaveProperty('virtualTourUrl');
    expect(card).not.toHaveProperty('facts');
  });
});

describe('applyAddressSuppression detail facts (#564)', () => {
  const extras = { virtualTourUrl: 'https://tours.example/142-oak-st' };
  const media = [
    {
      url: 'https://cdn.example/photo-1.jpg',
      altText: 'Front elevation of 142 Oak St',
      caption: 'Front elevation of 142 Oak St, seen from the street',
    },
  ];

  it('nulls the tour URL and every caption when the address is masked', () => {
    const suppressed = applyAddressSuppression(detailFixture({ address: null, media, extras }));

    expect(suppressed.listing.virtualTourUrl).toBeNull();
    expect(suppressed.listing.media[0]?.caption).toBeNull();
    expect(suppressed.listing.media[0]?.altText).toBeNull();
    expect(suppressed.listing.media[0]?.url).toBe('https://cdn.example/photo-1.jpg');
  });

  it('keeps the tour URL and the captions when the address is published', () => {
    const shown = applyAddressSuppression(detailFixture({ address: '142 Oak St', media, extras }));

    expect(shown.listing.virtualTourUrl).toBe(extras.virtualTourUrl);
    expect(shown.listing.media[0]?.caption).toContain('142 Oak St');
  });

  it('keeps tax, HOA and agent contact on a masked listing', () => {
    const suppressed = applyAddressSuppression(
      detailFixture({
        address: null,
        extras: { taxAnnualAmount: 5000, hoaFee: 100, listAgentEmail: 'agent@example.com' },
      }),
    );

    expect(suppressed.listing.taxAnnualAmount).toBe(5000);
    expect(suppressed.listing.hoaFee).toBe(100);
    expect(suppressed.listing.listAgentEmail).toBe('agent@example.com');
  });
});
