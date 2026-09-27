import { mapAttribution } from './attribution';

describe('mapAttribution', () => {
  it('maps the office record onto broker + office fields (phone and email both present)', () => {
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

  it('publishes phone-only (#344): office phone present, office email blank', () => {
    const result = mapAttribution({
      ListOfficeName: 'Acme Realty',
      ListOfficePhone: '2025551234',
    });
    expect(result).toEqual({
      ok: true,
      fields: {
        brokerName: 'Acme Realty',
        brokerPhone: '2025551234',
        brokerEmail: null,
        officeName: 'Acme Realty',
        officeBrokerLeadPhone: null,
        officeBrokerLeadEmail: null,
        listingAgentName: null,
      },
    });
  });

  it('publishes email-only (#344): office email present, office phone blank', () => {
    const result = mapAttribution({
      ListOfficeName: 'Acme Realty',
      ListOfficePhone: '   ',
      ListOfficeEmail: 'office@acme.example',
    });
    expect(result).toEqual({
      ok: true,
      fields: {
        brokerName: 'Acme Realty',
        brokerPhone: '',
        brokerEmail: 'office@acme.example',
        officeName: 'Acme Realty',
        officeBrokerLeadPhone: null,
        officeBrokerLeadEmail: null,
        listingAgentName: null,
      },
    });
  });

  it('fails closed when both office phone and office email are absent (#344)', () => {
    expect(mapAttribution({ ListOfficeName: 'Acme Realty' })).toEqual({
      ok: false,
      reason: 'missing_required_attribution',
    });
  });

  it('fails closed when the office name is missing', () => {
    expect(
      mapAttribution({ ListOfficePhone: '2025551234', ListOfficeEmail: 'office@acme.example' }),
    ).toEqual({ ok: false, reason: 'missing_required_attribution' });
  });

  it('falls back to the agent office phone (a genuine office line) when ListOfficePhone is blank', () => {
    const result = mapAttribution({
      ListOfficeName: 'Acme Realty',
      ListOfficePhone: null,
      ListOfficeEmail: 'office@acme.example',
      ListAgentOfficePhone: '2025555678',
    });
    expect(result).toEqual({
      ok: true,
      fields: {
        brokerName: 'Acme Realty',
        brokerPhone: '2025555678',
        brokerEmail: 'office@acme.example',
        officeName: 'Acme Realty',
        officeBrokerLeadPhone: '2025555678',
        officeBrokerLeadEmail: null,
        listingAgentName: null,
      },
    });
  });

  it('never falls back to the agent direct or preferred phone — those are personal, not office, lines', () => {
    expect(
      mapAttribution({
        ListOfficeName: 'Acme Realty',
        ListAgentDirectPhone: '2025558888',
        ListAgentPreferredPhone: '2025559999',
      }),
    ).toEqual({ ok: false, reason: 'missing_required_attribution' });
  });

  it('never falls back to the agent email — an individual address is not the brokerage email', () => {
    const result = mapAttribution({
      ListOfficeName: 'Acme Realty',
      ListAgentEmail: 'agent@acme.example',
    });
    // No office phone and no office email: the agent's personal email must not stand in for it.
    expect(result).toEqual({ ok: false, reason: 'missing_required_attribution' });
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
