import type { ListingDetail } from '@cribstop/property-contracts';
import { toListingDetailView } from '@/lib/api/listings';
import { type JsonLdObject, listingJsonLd } from '@/lib/listing-jsonld';
import { serializeJsonLd } from '@/lib/json-ld';
import { aListingDetail } from '@/test/fixtures';

const ORIGIN = 'https://example.com';

/** A row Bright MLS supplied: the only kind that emits JSON-LD. */
function ldFor(listing: Partial<ListingDetail['listing']> = {}, origin: string | null = ORIGIN) {
  return listingJsonLd(
    toListingDetailView(
      aListingDetail({ listing: { source: 'brightMLS', isSample: false, ...listing } }),
    ),
    origin,
  );
}

/** The allowed properties per schema.org type, taken from schema.org and its parent types. */
const ALLOWED: Record<string, string[]> = {
  RealEstateListing: [
    '@type',
    '@id',
    'url',
    'name',
    'datePosted',
    'dateModified',
    'about',
    'provider',
    'creditText',
    'publisher',
    'offers',
    'breadcrumb',
  ],
  Place: ['@type', 'name', 'address', 'geo'],
  PostalAddress: [
    '@type',
    'streetAddress',
    'postalCode',
    'addressLocality',
    'addressRegion',
    'addressCountry',
  ],
  GeoCoordinates: ['@type', 'latitude', 'longitude'],
  RealEstateAgent: ['@type', 'name', 'worksFor'],
  Organization: ['@type', 'name'],
  Offer: ['@type', 'availability', 'price', 'priceCurrency', 'priceSpecification'],
  UnitPriceSpecification: ['@type', 'price', 'priceCurrency', 'unitText'],
  BreadcrumbList: ['@type', '@id', 'itemListElement'],
  ListItem: ['@type', 'position', 'name', 'item'],
};

/** Walks a node and fails on any type or property that schema.org does not define for it. */
function expectSchemaShape(node: unknown): void {
  if (Array.isArray(node)) return node.forEach(expectSchemaShape);
  if (node === null || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  const type = obj['@type'];
  if (typeof type === 'string') {
    expect(Object.keys(ALLOWED)).toContain(type);
    for (const key of Object.keys(obj)) expect(ALLOWED[type]).toContain(key);
  }
  Object.values(obj).forEach(expectSchemaShape);
}

function listingNode(ld: JsonLdObject): Record<string, any> {
  return (ld['@graph'] as Record<string, any>[]).find((n) => n['@type'] === 'RealEstateListing')!;
}

describe('listingJsonLd', () => {
  it('emits a RealEstateListing, an Offer, a Place, a RealEstateAgent and a BreadcrumbList', () => {
    const ld = ldFor({ listingAgentName: 'Jane Agent', officeName: 'Bright Partner Realty' })!;
    const node = listingNode(ld);

    expect(ld['@context']).toBe('https://schema.org');
    expect(node.offers).toEqual({
      '@type': 'Offer',
      availability: 'https://schema.org/InStock',
      price: 750000,
      priceCurrency: 'USD',
    });
    expect(node.about.address.streetAddress).toBe('100 Test St');
    expect(node.provider).toEqual({
      '@type': 'RealEstateAgent',
      name: 'Jane Agent',
      worksFor: { '@type': 'Organization', name: 'Bright Partner Realty' },
    });
    const crumbs = (ld['@graph'] as any[]).find((n) => n['@type'] === 'BreadcrumbList');
    expect(crumbs.itemListElement.map((i: any) => i.position)).toEqual([1, 2, 3]);
    expect(crumbs.itemListElement[1].item).toBe(`${ORIGIN}/bethesda-md/homes-for-sale`);
    expectSchemaShape(ld);
  });

  it('carries the listing office and the Bright MLS attribution', () => {
    const node = listingNode(ldFor()!);

    expect(node.creditText).toContain('Information provided by Bright MLS.');
    expect(node.publisher.name).toBe('Real Broker, LLC');
    expect(node.provider.worksFor.name).toBeTruthy();
  });

  it('prices a rental per month', () => {
    const node = listingNode(ldFor({ listingType: 'rent', price: 2500 })!);

    expect(node.offers.priceSpecification).toMatchObject({ price: 2500, unitText: 'MONTH' });
    expectSchemaShape(node);
  });

  it('marks a Coming Soon home as pre-order', () => {
    expect(listingNode(ldFor({ status: 'Coming Soon' })!).offers.availability).toBe(
      'https://schema.org/PreOrder',
    );
  });

  it('keeps a masked address masked', () => {
    const ld = ldFor({
      address: null,
      latitude: null,
      longitude: null,
      title: '742 Evergreen Terrace',
    })!;
    const text = serializeJsonLd(ld);

    expect(text).not.toContain('streetAddress');
    expect(text).not.toContain('postalCode');
    expect(text).not.toContain('geo');
    expect(text).not.toContain('100 Test St');
    expect(text).not.toContain('742 Evergreen');
    expect(listingNode(ld).about.address.addressLocality).toBe('Bethesda');
    expectSchemaShape(ld);
  });

  it('emits no Offer for a suppressed price', () => {
    const node = listingNode(ldFor({ price: null })!);

    expect(node.offers).toBeUndefined();
    expect(serializeJsonLd(node)).not.toContain('Offer');
  });

  it('emits no Offer for a Pending home', () => {
    expect(listingNode(ldFor({ status: 'Pending' })!).offers).toBeUndefined();
  });

  it('emits nothing for a Sold home', () => {
    expect(ldFor({ status: 'Sold', closePrice: 700000, closeDate: '2026-03-04' })).toBeNull();
  });

  it('emits nothing for a sample row', () => {
    expect(ldFor({ isSample: true })).toBeNull();
  });

  it('emits nothing for a sponsored row', () => {
    expect(ldFor({ sponsored: true })).toBeNull();
  });

  it('emits nothing for a row Bright MLS did not supply', () => {
    expect(ldFor({ source: 'internal' })).toBeNull();
    expect(ldFor({ source: 'other' })).toBeNull();
  });

  it('emits nothing when no origin is vouched for', () => {
    expect(ldFor({}, null)).toBeNull();
  });

  it('falls back to the office when the feed names no agent', () => {
    const node = listingNode(ldFor({ listingAgentName: null })!);

    expect(node.provider['@type']).toBe('Organization');
  });
});

describe('serializeJsonLd', () => {
  it('escapes a closing script tag', () => {
    expect(serializeJsonLd({ name: '</script><b>' })).not.toContain('<');
  });
});
