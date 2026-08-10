import { ATTRIBUTION_KEYS } from './common';
import { toOpenApiDocument } from './openapi';

describe('toOpenApiDocument', () => {
  // `any` lets these assertions inspect the raw JSON Schema shape (the published contract)
  // rather than a typed wrapper.
  const doc: any = toOpenApiDocument();

  it('declares the three listings paths #22 will serve', () => {
    expect(Object.keys(doc.paths).sort()).toEqual([
      '/listings',
      '/listings/meta',
      '/listings/{id}',
    ]);
  });

  it('emits an OpenAPI 3.0 document with no server base path to prefix the paths', () => {
    expect(doc.openapi).toMatch(/^3\.0\./);
    expect(doc.servers).toBeUndefined();
  });

  it('renders nullable fields as nullable rather than as an untyped object', () => {
    const card = doc.components.schemas.ListingCardRow;
    expect(card.properties.beds.nullable).toBe(true);
    expect(card.properties.sqft).not.toEqual({});
  });

  it('publishes no field-selection parameter on the search endpoint', () => {
    const names = doc.paths['/listings'].get.parameters.map((p: { name: string }) => p.name);
    for (const forbidden of ['fields', 'select', 'include', 'omit', 'exclude']) {
      expect(names).not.toContain(forbidden);
    }
  });

  // A snapshot only detects change, not correctness — it would happily re-approve a document that
  // silently dropped an attribution key. `ListingCardRow.properties` is JSON Schema, which cannot
  // silently drop a declared key the way `z.object` strips an unknown one, so it is the
  // non-vacuous surface to assert the NAR 7.58 obligations against directly (#47 review, I6).
  it('publishes all eight NAR 7.58 attribution keys as required, non-optional fields', () => {
    const card = doc.components.schemas.ListingCardRow;
    const props = Object.keys(card.properties);
    expect(props).toEqual(expect.arrayContaining([...ATTRIBUTION_KEYS]));
    expect(card.required).toEqual(expect.arrayContaining([...ATTRIBUTION_KEYS]));
  });

  it('never republishes description, imageUrls or hasOpenHouse on the list row', () => {
    const props = Object.keys(doc.components.schemas.ListingCardRow.properties);
    for (const banned of ['description', 'imageUrls', 'hasOpenHouse']) {
      expect(props).not.toContain(banned);
    }
  });

  it('keeps the half-bath step pattern on the baths filter, not a whole-number-only one', () => {
    const bathsParam = doc.paths['/listings'].get.parameters.find(
      (p: { name: string }) => p.name === 'baths',
    );
    expect(bathsParam.schema.pattern).toBe('^\\d+(\\.5)?$');
  });

  it('keeps every nullable ListingCardRow field in `required` (present, never omitted)', () => {
    const card = doc.components.schemas.ListingCardRow;
    const nullableFields = Object.entries(card.properties as Record<string, { nullable?: boolean }>)
      .filter(([, propertySchema]) => propertySchema.nullable === true)
      .map(([name]) => name);
    // Sanity check that this assertion is actually exercising something.
    expect(nullableFields.length).toBeGreaterThan(0);
    expect(card.required).toEqual(expect.arrayContaining(nullableFields));
  });

  it('matches the committed golden document', () => {
    expect(doc).toMatchSnapshot();
  });
});
