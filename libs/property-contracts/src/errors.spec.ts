import { errorBodySchema, NOT_FOUND_BODY, RESULT_WINDOW_EXCEEDED_BODY } from './errors';
import { MAX_RESULT_OFFSET } from './search-request';

describe('errorBodySchema', () => {
  it('accepts NOT_FOUND_BODY', () => {
    expect(errorBodySchema.safeParse(NOT_FOUND_BODY).success).toBe(true);
  });

  it('parses NOT_FOUND_BODY without dropping or renaming a key', () => {
    expect(errorBodySchema.parse(NOT_FOUND_BODY)).toEqual(NOT_FOUND_BODY);
  });

  it('accepts RESULT_WINDOW_EXCEEDED_BODY', () => {
    expect(errorBodySchema.safeParse(RESULT_WINDOW_EXCEEDED_BODY).success).toBe(true);
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

  it('freezes the nested error object too, so an in-place write does not change it', () => {
    // Object.freeze is shallow, so the nested object must be frozen explicitly (see errors.ts).
    // Without this, `body.error.message = ...` at a call site would silently rewrite every
    // subsequent 404 response process-wide — this constant's whole reason to exist is that a
    // 404 is byte-identical regardless of why the listing isn't visible.
    expect(Object.isFrozen(NOT_FOUND_BODY.error)).toBe(true);

    expect(() => {
      // @ts-expect-error — intentionally attempting to mutate a frozen nested object.
      NOT_FOUND_BODY.error.message = 'mutated';
    }).toThrow();

    expect(NOT_FOUND_BODY.error.message).toBe('Listing not found.');
  });
});

describe('RESULT_WINDOW_EXCEEDED_BODY (#65)', () => {
  it('carries its own code, distinct from invalid_request — the two call for different client behaviour', () => {
    expect(RESULT_WINDOW_EXCEEDED_BODY.error.code).toBe('result_window_exceeded');
    expect(RESULT_WINDOW_EXCEEDED_BODY.error.code).not.toBe('invalid_request');
  });

  it('names the limit in the message, so the constraint is legible from the response alone', () => {
    expect(RESULT_WINDOW_EXCEEDED_BODY.error.message).toContain(String(MAX_RESULT_OFFSET));
    expect(RESULT_WINDOW_EXCEEDED_BODY.error.message).toMatch(/\(page - 1\) \* pageSize/);
  });

  it('says in words that this is a search surface rather than a bulk-export one', () => {
    expect(RESULT_WINDOW_EXCEEDED_BODY.error.message).toMatch(/not a bulk-export surface/i);
  });

  it('is frozen at both levels, like every other shared error body', () => {
    expect(Object.isFrozen(RESULT_WINDOW_EXCEEDED_BODY)).toBe(true);
    expect(Object.isFrozen(RESULT_WINDOW_EXCEEDED_BODY.error)).toBe(true);

    expect(() => {
      // @ts-expect-error — intentionally attempting to mutate a frozen nested object.
      RESULT_WINDOW_EXCEEDED_BODY.error.message = 'mutated';
    }).toThrow();
  });
});
