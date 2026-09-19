import { GATEWAY_ERROR_STATUS, gatewayErrorBodySchema, isGatewayErrorBody } from './errors';

describe('gatewayErrorBodySchema', () => {
  it('accepts the upstream_unavailable envelope', () => {
    expect(
      gatewayErrorBodySchema.safeParse({
        error: { code: 'upstream_unavailable', message: 'The service is temporarily unavailable.' },
      }).success,
    ).toBe(true);
  });

  it('accepts the rate_limited envelope', () => {
    expect(
      gatewayErrorBodySchema.safeParse({
        error: { code: 'rate_limited', message: 'Too many requests.' },
      }).success,
    ).toBe(true);
  });

  it('rejects a code the gateway does not emit', () => {
    expect(
      gatewayErrorBodySchema.safeParse({ error: { code: 'internal_error', message: 'x' } }).success,
    ).toBe(false);
  });

  it('rejects a body with no message', () => {
    expect(gatewayErrorBodySchema.safeParse({ error: { code: 'rate_limited' } }).success).toBe(
      false,
    );
  });
});

describe('isGatewayErrorBody', () => {
  it('accepts a well-formed gateway error body', () => {
    expect(isGatewayErrorBody({ error: { code: 'rate_limited', message: 'x' } })).toBe(true);
  });

  it('rejects the property-service error shape once the code is out of range', () => {
    expect(isGatewayErrorBody({ error: { code: 'not_found', message: 'x' } })).toBe(false);
  });

  it('rejects the account-service string envelope', () => {
    expect(isGatewayErrorBody({ error: 'Invalid email or password' })).toBe(false);
  });

  it('rejects the inference-service FastAPI envelope', () => {
    expect(isGatewayErrorBody({ detail: 'Not found' })).toBe(false);
  });

  it('rejects null and non-object input', () => {
    expect(isGatewayErrorBody(null)).toBe(false);
    expect(isGatewayErrorBody('rate_limited')).toBe(false);
  });
});

describe('GATEWAY_ERROR_STATUS', () => {
  it('pairs upstream_unavailable with 502 and 503', () => {
    expect(GATEWAY_ERROR_STATUS.upstream_unavailable).toEqual([502, 503]);
  });

  it('pairs rate_limited with 429', () => {
    expect(GATEWAY_ERROR_STATUS.rate_limited).toEqual([429]);
  });
});
