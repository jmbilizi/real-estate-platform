import { resolveDeliveryTuning, resolveSendConfig } from './config';

const FULL = {
  INQUIRY_EXTERNAL_SEND: 'true',
  POSTMARK_SERVER_TOKEN: 'POSTMARK_API_TEST',
  INQUIRY_INTAKE_ADDRESS: 'intake@cribstop.example',
  INQUIRY_FROM_ADDRESS: 'no-reply@cribstop.example',
};

describe('resolveSendConfig (fail closed)', () => {
  it('sends when permission, token and both addresses are configured', () => {
    const result = resolveSendConfig(FULL);
    expect(result.disabledReason).toBeNull();
    expect(result.send?.intakeAddress).toBe('intake@cribstop.example');
    expect(result.send?.messageStream).toBe('outbound');
  });

  it.each([undefined, '', 'false', 'TRUE', '1', 'yes'])(
    'does not send when INQUIRY_EXTERNAL_SEND is %p',
    (value) => {
      const result = resolveSendConfig({ ...FULL, INQUIRY_EXTERNAL_SEND: value });
      expect(result.send).toBeNull();
      expect(result.disabledReason).toMatch(/INQUIRY_EXTERNAL_SEND/);
    },
  );

  it('ignores any environment name: NODE_ENV alone never grants permission', () => {
    const result = resolveSendConfig({
      ...FULL,
      INQUIRY_EXTERNAL_SEND: undefined,
      NODE_ENV: 'production',
    });
    expect(result.send).toBeNull();
  });

  it.each(['POSTMARK_SERVER_TOKEN', 'INQUIRY_INTAKE_ADDRESS', 'INQUIRY_FROM_ADDRESS'])(
    'does not send when %s is unset, empty or the committed placeholder',
    (name) => {
      for (const value of [undefined, '  ', 'StrongBase64Password']) {
        const result = resolveSendConfig({ ...FULL, [name]: value });
        expect(result.send).toBeNull();
        expect(result.disabledReason).toContain(name);
      }
    },
  );
});

describe('resolveDeliveryTuning', () => {
  it('uses defaults and ignores invalid values', () => {
    const tuning = resolveDeliveryTuning({
      INQUIRY_DELIVERY_MAX_ATTEMPTS: 'abc',
      INQUIRY_DELIVERY_BATCH_SIZE: '-3',
    });
    expect(tuning.maxAttempts).toBe(8);
    expect(tuning.batchSize).toBe(10);
    expect(tuning.siteOrigin).toBeNull();
  });

  it('trims the trailing slash from the site origin', () => {
    expect(
      resolveDeliveryTuning({ INQUIRY_SITE_ORIGIN: 'https://cribstop.example/' }).siteOrigin,
    ).toBe('https://cribstop.example');
  });
});
