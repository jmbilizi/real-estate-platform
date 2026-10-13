import { BRAND } from '@/lib/brand';
import { organizationJsonLd } from '@/lib/organization-jsonld';

const ORIGIN = 'https://example.com';

/** The allowed properties per schema.org type. */
const ALLOWED: Record<string, string[]> = {
  Organization: ['@type', '@id', 'name', 'url', 'brand', 'areaServed', 'sameAs'],
  RealEstateAgent: ['@type', '@id', 'name', 'url', 'brand', 'areaServed', 'identifier'],
  Brand: ['@type', 'name'],
  AdministrativeArea: ['@type', 'name'],
};

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

describe('organizationJsonLd', () => {
  const graph = () => organizationJsonLd(ORIGIN)!['@graph'] as Record<string, any>[];

  it('names Real Broker, LLC as the Organization and Cribstop as its brand', () => {
    const org = graph().find((n) => n['@type'] === 'Organization')!;

    expect(org.name).toBe('Real Broker, LLC');
    expect(org.brand.name).toBe('Cribstop');
    expect(org.url).toBe(`${ORIGIN}/`);
  });

  it('reads sameAs and areaServed from config', () => {
    const org = graph().find((n) => n['@type'] === 'Organization')!;

    expect(org.sameAs).toEqual([...BRAND.brokerageProfileUrls]);
    expect(org.areaServed.map((a: any) => a.name)).toEqual(BRAND.licensedMarketNames);
    expect(BRAND.licensedMarketNames).toEqual(['Maryland', 'District of Columbia', 'Virginia']);
  });

  it('emits a RealEstateAgent node', () => {
    expect(graph().some((n) => n['@type'] === 'RealEstateAgent')).toBe(true);
  });

  it('publishes no licence number while config has none', () => {
    expect(BRAND.licenseNumbers).toEqual({});
    expect(JSON.stringify(graph())).not.toContain('identifier');
  });

  it('matches the schema.org shape', () => {
    expectSchemaShape(organizationJsonLd(ORIGIN));
  });

  it('emits nothing when no origin is vouched for', () => {
    expect(organizationJsonLd(null)).toBeNull();
  });
});
