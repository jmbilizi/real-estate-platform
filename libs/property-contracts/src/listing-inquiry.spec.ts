import {
  CONSENT_DISCLOSURE_TEXT,
  CONSENT_TEXTS,
  CURRENT_CONSENT_TEXT_VERSION,
  listingInquiryRequestSchema,
} from './listing-inquiry';

const BASE = {
  kind: 'tour_request' as const,
  consentToContact: true,
  consentTextVersion: 'v1' as const,
};

describe('listingInquiryRequestSchema', () => {
  it('accepts a minimal tour request', () => {
    const result = listingInquiryRequestSchema.safeParse(BASE);
    expect(result.success).toBe(true);
  });

  it('accepts consent with no consentTextVersion, for older clients (#631)', () => {
    const { consentTextVersion: _omitted, ...withoutVersion } = BASE;
    expect(listingInquiryRequestSchema.safeParse(withoutVersion).success).toBe(true);
  });

  it('never infers consent true from any other field', () => {
    const { consentToContact: _c, consentTextVersion: _v, ...bare } = BASE;
    const result = listingInquiryRequestSchema.parse({ ...bare, phone: '555-0100' });
    expect(result.consentToContact).toBe(false);
  });

  describe('Fair Housing guardrail — strict parse (#34)', () => {
    it.each([
      'age',
      'householdSize',
      'occupancy',
      'familialStatus',
      'disability',
      'userType',
      'seniors',
      'children',
      'pets',
    ])('rejects an unknown field: %s', (field) => {
      const result = listingInquiryRequestSchema.safeParse({ ...BASE, [field]: 'anything' });
      expect(result.success).toBe(false);
    });
  });

  describe('message requirement by kind', () => {
    it('requires a non-empty message when kind is "message"', () => {
      const result = listingInquiryRequestSchema.safeParse({ ...BASE, kind: 'message' });
      expect(result.success).toBe(false);
    });

    it('rejects an empty-string message for kind "message"', () => {
      const result = listingInquiryRequestSchema.safeParse({
        ...BASE,
        kind: 'message',
        message: '   ',
      });
      expect(result.success).toBe(false);
    });

    it('accepts kind "message" with a real message', () => {
      const result = listingInquiryRequestSchema.safeParse({
        ...BASE,
        kind: 'message',
        message: 'Is this still available?',
      });
      expect(result.success).toBe(true);
    });

    it('does not require a message for kind "tour_request"', () => {
      const result = listingInquiryRequestSchema.safeParse({ ...BASE, kind: 'tour_request' });
      expect(result.success).toBe(true);
    });
  });

  describe('no contact details in the body (#690)', () => {
    it('rejects a body name', () => {
      expect(listingInquiryRequestSchema.safeParse({ ...BASE, name: 'Jane' }).success).toBe(false);
    });

    it('rejects a body email', () => {
      const result = listingInquiryRequestSchema.safeParse({ ...BASE, email: 'jane@example.com' });
      expect(result.success).toBe(false);
    });
  });

  it('rejects an unknown kind', () => {
    const result = listingInquiryRequestSchema.safeParse({ ...BASE, kind: 'callback' });
    expect(result.success).toBe(false);
  });
});

describe('consent evidence fields', () => {
  const CONSENTED = { ...BASE, phone: '202-555-0100' };

  it('accepts a version and channels with consent', () => {
    const result = listingInquiryRequestSchema.safeParse({
      ...CONSENTED,
      consentTextVersion: 'v1',
      consentChannels: ['email', 'phone_text'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects consent evidence without consent', () => {
    const result = listingInquiryRequestSchema.safeParse({ ...BASE, consentToContact: false });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown version, an unknown channel and an empty channel list', () => {
    for (const extra of [
      { consentTextVersion: 'v99' },
      { consentChannels: ['carrier_pigeon'] },
      { consentChannels: [] },
      { consentChannels: ['email', 'email'] },
    ]) {
      expect(listingInquiryRequestSchema.safeParse({ ...CONSENTED, ...extra }).success).toBe(false);
    }
  });

  it('rejects a phone channel with no phone', () => {
    const result = listingInquiryRequestSchema.safeParse({
      ...BASE,
      consentChannels: ['phone_call'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects the server-owned verifiedAccount field', () => {
    expect(listingInquiryRequestSchema.safeParse({ ...BASE, verifiedAccount: true }).success).toBe(
      false,
    );
  });
});

describe('consent text versions (#630)', () => {
  it('keeps v1 readable and makes v2 current', () => {
    expect(CONSENT_TEXTS.v1).toContain('Consent is not required to use Cribstop');
    expect(CURRENT_CONSENT_TEXT_VERSION).toBe('v2');
    expect(CONSENT_DISCLOSURE_TEXT).toBe(CONSENT_TEXTS.v2);
  });

  it('carries the TCPA elements in v2', () => {
    expect(CONSENT_TEXTS.v2).toContain('not a condition of buying any property, goods or services');
    expect(CONSENT_TEXTS.v2).toContain('Message frequency varies.');
    expect(CONSENT_TEXTS.v2).toContain('Reply STOP to stop texts.');
    expect(CONSENT_TEXTS.v2).toContain('Terms of Service and Privacy Policy');
  });

  it('rejects a client-supplied consent text', () => {
    const result = listingInquiryRequestSchema.safeParse({
      ...BASE,
      consentDisclosureText: 'my own text',
    });
    expect(result.success).toBe(false);
  });

  it('accepts v1 and v2 and rejects any other version', () => {
    for (const consentTextVersion of ['v1', 'v2']) {
      expect(listingInquiryRequestSchema.safeParse({ ...BASE, consentTextVersion }).success).toBe(
        true,
      );
    }
    expect(
      listingInquiryRequestSchema.safeParse({ ...BASE, consentTextVersion: 'v3' }).success,
    ).toBe(false);
  });
});

describe('CONSENT_DISCLOSURE_TEXT', () => {
  it('is a non-empty, stable sentence', () => {
    expect(CONSENT_DISCLOSURE_TEXT.length).toBeGreaterThan(10);
  });
});
