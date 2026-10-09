/** @jest-environment node */
import { middleware } from './middleware';

const original = process.env.SITE_ORIGIN;
afterEach(() => {
  if (original === undefined) delete process.env.SITE_ORIGIN;
  else process.env.SITE_ORIGIN = original;
});

describe('middleware', () => {
  it.each(['https://dev.cribstop.com', 'https://test.cribstop.com', ''])(
    'sends noindex when SITE_ORIGIN is %p',
    (origin) => {
      process.env.SITE_ORIGIN = origin;
      expect(middleware().headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    },
  );

  it('sends noindex when SITE_ORIGIN is unset', () => {
    delete process.env.SITE_ORIGIN;
    expect(middleware().headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  });

  it('sends no header on the production origin', () => {
    process.env.SITE_ORIGIN = 'https://cribstop.com';
    expect(middleware().headers.get('X-Robots-Tag')).toBeNull();
  });
});
