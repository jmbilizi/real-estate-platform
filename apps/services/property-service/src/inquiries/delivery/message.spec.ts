import { buildIntakeMessage, type InquiryForDelivery } from './message';

const OPTIONS = {
  intakeAddress: 'intake@cribstop.example',
  fromAddress: 'no-reply@cribstop.example',
  siteOrigin: 'https://cribstop.example',
};

function inquiry(overrides: Partial<InquiryForDelivery> = {}): InquiryForDelivery {
  return {
    id: 'inq-1',
    listing_id: 'lst-1',
    kind: 'tour_request',
    name: 'Jane Consumer',
    email: 'jane@example.com',
    phone: '555-0100',
    message: 'Line one.\n<b>Line two</b> & more',
    created_at: new Date('2026-10-04T12:00:00Z'),
    address: '12 Main St, Reston, VA',
    address_display_allowed: true,
    ...overrides,
  };
}

describe('buildIntakeMessage', () => {
  it('sends to the configured intake address only', () => {
    const message = buildIntakeMessage(inquiry({ email: 'listing-agent@example.com' }), OPTIONS);
    expect(message.to).toBe('intake@cribstop.example');
    expect(message.from).toBe('no-reply@cribstop.example');
  });

  it('carries listing id, link, contact details, kind and the Real Broker, LLC line', () => {
    const body = buildIntakeMessage(inquiry(), OPTIONS).textBody;
    expect(body).toContain('Listing ID: lst-1');
    expect(body).toContain('Listing link: https://cribstop.example/listing/lst-1');
    expect(body).toContain('Request type: Tour request');
    expect(body).toContain('Name: Jane Consumer');
    expect(body).toContain('Email: jane@example.com');
    expect(body).toContain('Phone: 555-0100');
    expect(body).toContain('Real Broker, LLC');
  });

  it('passes the consumer text through unchanged', () => {
    expect(buildIntakeMessage(inquiry(), OPTIONS).textBody).toContain(
      'Line one.\n<b>Line two</b> & more',
    );
  });

  it('includes the address only when address_display_allowed is true', () => {
    expect(buildIntakeMessage(inquiry(), OPTIONS).textBody).toContain('12 Main St');
    const hidden = buildIntakeMessage(
      inquiry({ address_display_allowed: false }),
      OPTIONS,
    ).textBody;
    expect(hidden).not.toContain('12 Main St');
    const unknown = buildIntakeMessage(
      inquiry({ address_display_allowed: null }),
      OPTIONS,
    ).textBody;
    expect(unknown).not.toContain('12 Main St');
  });

  it('omits the link when no site origin is configured', () => {
    const body = buildIntakeMessage(inquiry(), { ...OPTIONS, siteOrigin: null }).textBody;
    expect(body).not.toContain('Listing link');
  });

  it('keeps consumer free text out of the subject', () => {
    const subject = buildIntakeMessage(inquiry(), OPTIONS).subject;
    expect(subject).not.toContain('Line one');
    expect(subject).toContain('inq-1');
  });
});
