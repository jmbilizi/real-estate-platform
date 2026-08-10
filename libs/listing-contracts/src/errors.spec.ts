import { errorBodySchema, NOT_FOUND_BODY } from './errors';

describe('errorBodySchema', () => {
  it('accepts NOT_FOUND_BODY', () => {
    expect(errorBodySchema.safeParse(NOT_FOUND_BODY).success).toBe(true);
  });

  it('parses NOT_FOUND_BODY without dropping or renaming a key', () => {
    expect(errorBodySchema.parse(NOT_FOUND_BODY)).toEqual(NOT_FOUND_BODY);
  });

  it('rejects an unknown error code', () => {
    expect(errorBodySchema.safeParse({ error: { code: 'nope', message: 'x' } }).success).toBe(
      false,
    );
  });
});

describe('NOT_FOUND_BODY', () => {
  it('is frozen at the top level and a mutation attempt does not change it', () => {
    expect(Object.isFrozen(NOT_FOUND_BODY)).toBe(true);

    expect(() => {
      // @ts-expect-error — intentionally attempting to mutate a frozen object.
      NOT_FOUND_BODY.error = { code: 'invalid_request', message: 'mutated' };
    }).toThrow();

    expect(NOT_FOUND_BODY).toEqual({
      error: { code: 'not_found', message: 'Listing not found.' },
    });
  });

  it('does NOT freeze the nested error object (Object.freeze is shallow)', () => {
    // This documents current behaviour rather than asserting a requirement: a caller could
    // mutate NOT_FOUND_BODY.error's fields in place without a deep freeze. Flagged for the
    // coordinator to decide whether a deep freeze should be added.
    expect(Object.isFrozen(NOT_FOUND_BODY.error)).toBe(false);
  });
});
