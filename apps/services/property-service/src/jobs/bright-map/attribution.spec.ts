import { mapAttribution } from './attribution';

describe('mapAttribution', () => {
  it('maps the office record onto broker + office fields', () => {
    const result = mapAttribution({
      ListOfficeName: 'Acme Realty',
      ListOfficePhone: '2025551234',
      ListOfficeEmail: 'office@acme.example',
      ListAgentFullName: 'Jane Agent',
      ListAgentOfficePhone: '2025555678',
    });
    expect(result).toEqual({
      ok: true,
      fields: {
        brokerName: 'Acme Realty',
        brokerPhone: '2025551234',
        brokerEmail: 'office@acme.example',
        officeName: 'Acme Realty',
        officeBrokerLeadPhone: '2025555678',
        officeBrokerLeadEmail: null,
        listingAgentName: 'Jane Agent',
      },
    });
  });

  it('fails closed when the office name is missing', () => {
    expect(
      mapAttribution({ ListOfficePhone: '2025551234', ListOfficeEmail: 'office@acme.example' }),
    ).toEqual({ ok: false, reason: 'missing_required_attribution' });
  });

  it('fails closed when the office phone is blank', () => {
    expect(
      mapAttribution({
        ListOfficeName: 'Acme Realty',
        ListOfficePhone: '   ',
        ListOfficeEmail: 'office@acme.example',
      }),
    ).toEqual({ ok: false, reason: 'missing_required_attribution' });
  });

  it('fails closed when the office email is absent entirely', () => {
    expect(mapAttribution({ ListOfficeName: 'Acme Realty', ListOfficePhone: '2025551234' })).toEqual(
      { ok: false, reason: 'missing_required_attribution' },
    );
  });

  it('leaves the optional agent fields null when Bright omits them', () => {
    const result = mapAttribution({
      ListOfficeName: 'Acme Realty',
      ListOfficePhone: '2025551234',
      ListOfficeEmail: 'office@acme.example',
    });
    expect(result).toEqual({
      ok: true,
      fields: {
        brokerName: 'Acme Realty',
        brokerPhone: '2025551234',
        brokerEmail: 'office@acme.example',
        officeName: 'Acme Realty',
        officeBrokerLeadPhone: null,
        officeBrokerLeadEmail: null,
        listingAgentName: null,
      },
    });
  });
});
