import { searchCanonical, searchUrlKind } from './seo-config';

describe('searchUrlKind (#847)', () => {
  const kind = (qs: string) => searchUrlKind(new URLSearchParams(qs));

  it('ignores tracking parameters', () => {
    expect(kind('utm_source=ig&fbclid=x')).toEqual({ kind: 'clean' });
    expect(kind('page=2&gclid=x')).toEqual({ kind: 'paginated', page: 2 });
    expect(kind('beds=3&utm_source=ig')).toEqual({ kind: 'filtered' });
  });

  it('treats a path with no parameter as clean', () => {
    expect(kind('')).toEqual({ kind: 'clean' });
  });

  it.each(['boundary=abc', 'bounds=1,2,3,4', 'beds=3', 'type=all', 'q=x', 'beds=3&page=2'])(
    'treats %s as filtered',
    (qs) => {
      expect(kind(qs)).toEqual({ kind: 'filtered' });
    },
  );

  it('treats page 2 and up as paginated', () => {
    expect(kind('page=2')).toEqual({ kind: 'paginated', page: 2 });
    expect(kind('page=40')).toEqual({ kind: 'paginated', page: 40 });
  });

  it.each(['page=1', 'page=0', 'page=-3', 'page=abc', 'page=2.5', 'page=2&page=3', 'page='])(
    'treats %s as filtered, a duplicate of the clean path',
    (qs) => {
      expect(kind(qs)).toEqual({ kind: 'filtered' });
    },
  );
});

describe('searchCanonical (#847)', () => {
  it('names the clean path for a clean or filtered URL', () => {
    expect(searchCanonical('https://x.test/', '/homes-for-sale', { kind: 'clean' })).toBe(
      'https://x.test/homes-for-sale',
    );
    expect(searchCanonical('https://x.test', '/homes-for-sale', { kind: 'filtered' })).toBe(
      'https://x.test/homes-for-sale',
    );
  });

  it('names the page itself for a paginated URL', () => {
    expect(
      searchCanonical('https://x.test', '/a/homes-for-sale', { kind: 'paginated', page: 3 }),
    ).toBe('https://x.test/a/homes-for-sale?page=3');
  });

  it('is null without an origin', () => {
    expect(searchCanonical(null, '/homes-for-sale', { kind: 'clean' })).toBeNull();
  });
});
