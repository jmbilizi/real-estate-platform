import type { ZipGroup } from '@cribstop/property-contracts';
import { breadcrumbJsonLd, nearbyZips, zipBreadcrumbs } from './zip-page';

const AREA = { city: 'Alexandria', state: 'VA' };

describe('zipBreadcrumbs (#973)', () => {
  it('lists Home, City, ZIP when the ZIP maps to one city', () => {
    expect(zipBreadcrumbs('22304', 'homes-for-sale', AREA)).toEqual([
      { name: 'Home', path: '/' },
      { name: 'Alexandria, VA', path: '/alexandria-va/homes-for-sale' },
      { name: '22304', path: '/22304/homes-for-sale' },
    ]);
  });

  it('drops the City level when the feed names no single city', () => {
    expect(zipBreadcrumbs('22304', 'homes-for-rent', undefined)).toEqual([
      { name: 'Home', path: '/' },
      { name: '22304', path: '/22304/homes-for-rent' },
    ]);
  });
});

describe('breadcrumbJsonLd (#973)', () => {
  const crumbs = zipBreadcrumbs('22304', 'homes-for-sale', AREA);

  it('emits a BreadcrumbList with absolute URLs and positions from 1', () => {
    expect(breadcrumbJsonLd('https://cribstop.example/', crumbs)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://cribstop.example/' },
        {
          '@type': 'ListItem',
          position: 2,
          name: 'Alexandria, VA',
          item: 'https://cribstop.example/alexandria-va/homes-for-sale',
        },
        {
          '@type': 'ListItem',
          position: 3,
          name: '22304',
          item: 'https://cribstop.example/22304/homes-for-sale',
        },
      ],
    });
  });

  it('is null without a vouched origin', () => {
    expect(breadcrumbJsonLd(null, crumbs)).toBeNull();
  });
});

describe('nearbyZips (#973)', () => {
  const group = (key: string, count: number): ZipGroup => ({ key, count });

  it('orders by count descending, then ZIP ascending', () => {
    const result = nearbyZips(
      [group('22306', 12), group('22302', 30), group('22301', 12), group('22305', 20)],
      '22304',
      'homes-for-sale',
      10,
    );
    expect(result.map((item) => item.zip)).toEqual(['22302', '22305', '22301', '22306']);
    expect(result[0]).toEqual({ zip: '22302', count: 30, path: '/22302/homes-for-sale' });
  });

  it('leaves out the current ZIP and every ZIP below the threshold', () => {
    const result = nearbyZips(
      [group('22304', 50), group('22302', 10), group('22301', 9)],
      '22304',
      'homes-for-sale',
      10,
    );
    expect(result.map((item) => item.zip)).toEqual(['22302']);
  });

  it('lists at most 8', () => {
    const groups = Array.from({ length: 12 }, (_, i) => group(String(22300 + i), 20 + i));
    expect(nearbyZips(groups, '99999', 'homes-for-sale', 10)).toHaveLength(8);
  });

  it('uses the rent path for a rent page', () => {
    expect(nearbyZips([group('22302', 12)], '22304', 'homes-for-rent', 10)[0]?.path).toBe(
      '/22302/homes-for-rent',
    );
  });
});
