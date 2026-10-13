import { BRAND } from '@/lib/brand';
import type { JsonLdObject } from '@/lib/listing-jsonld';

/**
 * Structured data for the brokerage (#844). Real Broker, LLC is the entity. Cribstop is its
 * consumer brand, so it appears second, as the `brand`.
 *
 * Every value comes from `BRAND`. A licence number is published only when `BRAND.licenseNumbers`
 * lists it. The result is null when no origin is vouched for, because every node needs a URL.
 */
export function organizationJsonLd(origin: string | null): JsonLdObject | null {
  if (origin === null) return null;
  const url = `${origin.replace(/\/$/, '')}/`;
  const areaServed = BRAND.licensedMarketNames.map((name) => ({
    '@type': 'AdministrativeArea',
    name,
  }));
  const brand = { '@type': 'Brand', name: BRAND.siteName };
  const licenses = Object.entries(BRAND.licenseNumbers).map(
    ([state, number]) => `${state} ${number}`,
  );

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${url}#organization`,
        name: BRAND.brokerage,
        url,
        brand,
        areaServed,
        ...(BRAND.brokerageProfileUrls.length > 0
          ? { sameAs: [...BRAND.brokerageProfileUrls] }
          : {}),
      },
      {
        '@type': 'RealEstateAgent',
        '@id': `${url}#brokerage`,
        name: BRAND.brokerage,
        url,
        brand,
        areaServed,
        ...(licenses.length > 0 ? { identifier: licenses } : {}),
      },
    ],
  };
}
