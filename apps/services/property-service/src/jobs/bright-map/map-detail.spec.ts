import { FACT_GROUPS, mapListingDetailFacts } from './map-detail';

const FULL = {
  TaxAnnualAmount: 5120.5,
  TaxYear: 2025,
  AssociationFee: 310,
  AssociationFeeFrequency: 'Monthly',
  VirtualTourURLUnbranded: 'https://tours.example/abc',
  ListAgentPreferredPhone: '2025550100',
  ListAgentDirectPhone: '2025550101',
  ListAgentEmail: 'agent@example.com',
  ParkingFeatures: ['Driveway', 'Off Street'],
  Heating: ['Forced Air'],
  Cooling: ['Central A/C'],
  Appliances: ['Dishwasher', 'Dishwasher', ' ', 'Oven/Range'],
  Basement: ['Finished'],
  Flooring: ['Hardwood'],
  InteriorFeatures: ['Crown Molding'],
  ExteriorFeatures: ['Deck'],
};

describe('mapListingDetailFacts (#564)', () => {
  it('maps every present field', () => {
    expect(mapListingDetailFacts(FULL)).toEqual({
      taxAnnualAmount: 5120.5,
      taxYear: 2025,
      hoaFee: 310,
      hoaFeeFrequency: 'Monthly',
      virtualTourUrl: 'https://tours.example/abc',
      listAgentPhone: '2025550100',
      listAgentEmail: 'agent@example.com',
      facts: {
        parking: ['Driveway', 'Off Street'],
        heating: ['Forced Air'],
        cooling: ['Central A/C'],
        appliances: ['Dishwasher', 'Oven/Range'],
        basement: ['Finished'],
        flooring: ['Hardwood'],
        interior: ['Crown Molding'],
        exterior: ['Deck'],
      },
    });
  });

  it('maps an empty record to null scalars and empty groups, inventing nothing', () => {
    const mapped = mapListingDetailFacts({});
    expect(mapped).toMatchObject({
      taxAnnualAmount: null,
      taxYear: null,
      hoaFee: null,
      hoaFeeFrequency: null,
      virtualTourUrl: null,
      listAgentPhone: null,
      listAgentEmail: null,
    });
    for (const group of FACT_GROUPS) {
      expect(mapped.facts[group]).toEqual([]);
    }
  });

  it('keeps a real zero HOA fee and rejects a negative or non-numeric amount', () => {
    expect(mapListingDetailFacts({ AssociationFee: 0 }).hoaFee).toBe(0);
    expect(mapListingDetailFacts({ AssociationFee: -5 }).hoaFee).toBeNull();
    expect(mapListingDetailFacts({ TaxAnnualAmount: '5000' }).taxAnnualAmount).toBeNull();
  });

  it('drops an implausible tax year', () => {
    expect(mapListingDetailFacts({ TaxYear: 0 }).taxYear).toBeNull();
    expect(mapListingDetailFacts({ TaxYear: 25 }).taxYear).toBeNull();
  });

  it('shows only an http(s) tour URL', () => {
    expect(
      mapListingDetailFacts({ VirtualTourURLUnbranded: 'javascript:alert(1)' }).virtualTourUrl,
    ).toBeNull();
    expect(
      mapListingDetailFacts({ VirtualTourURLUnbranded: 'not a url' }).virtualTourUrl,
    ).toBeNull();
    expect(mapListingDetailFacts({ VirtualTourURLUnbranded: '  ' }).virtualTourUrl).toBeNull();
  });

  it('does not read the branded tour field', () => {
    const mapped = mapListingDetailFacts({ VirtualTourURLBranded: 'https://branded.example/x' });
    expect(mapped.virtualTourUrl).toBeNull();
  });

  it('falls back to the direct phone, and never to the cell phone', () => {
    expect(mapListingDetailFacts({ ListAgentDirectPhone: '2025550101' }).listAgentPhone).toBe(
      '2025550101',
    );
    expect(mapListingDetailFacts({ ListAgentCellPhone: '2025550102' }).listAgentPhone).toBeNull();
  });

  it('ignores a collection that is not an array, and caps a long one', () => {
    expect(mapListingDetailFacts({ Heating: 'Forced Air' }).facts.heating).toEqual([]);
    const many = Array.from({ length: 50 }, (_, i) => `Item ${i}`);
    expect(mapListingDetailFacts({ Appliances: many }).facts.appliances).toHaveLength(30);
    expect(mapListingDetailFacts({ Flooring: ['x'.repeat(81)] }).facts.flooring).toEqual([]);
  });
});
