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

  it('matches the committed golden document', () => {
    expect(doc).toMatchSnapshot();
  });
});
