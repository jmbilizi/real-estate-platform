import { CONSENT_DISCLOSURE_TEXT, listingInquiryRequestSchema } from './listing-inquiry';

const BASE = {
  kind: 'tour_request' as const,
  name: 'Jane Consumer',
  email: 'jane@example.com',
};

describe('listingInquiryRequestSchema', () => {
  it('accepts a minimal signed-out tour request', () => {
    const result = listingInquiryRequestSchema.safeParse(BASE);
    expect(result.success).toBe(true);
  });

  it('defaults consentToContact to false when absent', () => {
    const result = listingInquiryRequestSchema.parse(BASE);
    expect(result.consentToContact).toBe(false);
  });

  it('never infers consent true from any other field', () => {
    const result = listingInquiryRequestSchema.parse({ ...BASE, phone: '555-0100' });
    expect(result.consentToContact).toBe(false);
  });

  it('accepts an explicit consentToContact: true', () => {
    const result = listingInquiryRequestSchema.parse({ ...BASE, consentToContact: true });
    expect(result.consentToContact).toBe(true);
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

  describe('required contact details, signed-out or signed-in alike', () => {
    it('rejects a missing name', () => {
      const { name: _name, ...withoutName } = BASE;
      expect(listingInquiryRequestSchema.safeParse(withoutName).success).toBe(false);
    });

    it('rejects a missing email', () => {
      const { email: _email, ...withoutEmail } = BASE;
      expect(listingInquiryRequestSchema.safeParse(withoutEmail).success).toBe(false);
    });

    it('rejects a malformed email', () => {
      const result = listingInquiryRequestSchema.safeParse({ ...BASE, email: 'not-an-email' });
      expect(result.success).toBe(false);
    });
  });

  it('rejects an unknown kind', () => {
    const result = listingInquiryRequestSchema.safeParse({ ...BASE, kind: 'callback' });
    expect(result.success).toBe(false);
  });
});

describe('CONSENT_DISCLOSURE_TEXT', () => {
  it('is a non-empty, stable sentence', () => {
    expect(CONSENT_DISCLOSURE_TEXT.length).toBeGreaterThan(10);
  });
});
