import { ATTRIBUTION_KEYS } from './common';
import { toOpenApiDocument } from './openapi';
import { PAGE_SIZE_MAX } from './search-request';

describe('toOpenApiDocument', () => {
  // `any` lets these assertions inspect the raw JSON Schema shape (the published contract)
  // rather than a typed wrapper.
  const doc: any = toOpenApiDocument();

  // property-service owns the whole Communities → Properties → Units → Listings hierarchy, so its
  // HTTP surface is the Property API, singular — `listings` is one resource within it. The same
  // inversion #47 made when `libs/listing-contracts` became `libs/property-contracts`. The URL
  // paths deliberately stay `/listings/*`: a service name is not a resource name.
  it('publishes the singular Property API title, not a per-resource one', () => {
    expect(doc.info.title).toBe('Cribstop Property API');
    expect(Object.keys(doc.paths)).toContain('/listings');
  });

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

  // The pageSize pattern's upper bound (`^([1-9][0-9]?|100)$`) is a hand-written regex, not
  // derived from PAGE_SIZE_MAX — so lowering that constant would go uncaught: the pattern would
  // keep advertising 1-100 while the service enforces a smaller cap, over-promising to any client
  // built against the published contract. Deriving expected pass/fail values from the constant
  // itself, rather than hard-coding "100"/"101" here, makes this test fail the moment the pattern
  // and the constant disagree in either direction (#47 review round 2, finding 2).
  it('keeps the pageSize pattern bound in sync with PAGE_SIZE_MAX', () => {
    const pageSizeParam = doc.paths['/listings'].get.parameters.find(
      (p: { name: string }) => p.name === 'pageSize',
    );
    const pattern = new RegExp(pageSizeParam.schema.pattern);
    expect(pattern.test(String(PAGE_SIZE_MAX))).toBe(true);
    expect(pattern.test(String(PAGE_SIZE_MAX + 1))).toBe(false);
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
