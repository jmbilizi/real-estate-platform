import { lookingForRequestSchema, toOpenApiDocument } from './index';

const place = { kind: 'city', state: 'VA', city: 'Alexandria' } as const;
const valid = { intent: 'buy', places: [place] };

const refusedPaths = (input: unknown): string[] => {
  const result = lookingForRequestSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
};

describe('lookingForRequestSchema (#768)', () => {
  it('accepts a minimal request and a full one', () => {
    expect(lookingForRequestSchema.safeParse(valid).success).toBe(true);
    expect(
      lookingForRequestSchema.safeParse({
        intent: 'rent',
        places: [place, { kind: 'zip', state: 'VA', city: 'Alexandria', zip: '22314' }],
        priceMin: 1000,
        priceMax: 3000,
        bedsMin: 2,
        bathsMin: 1,
        homeTypes: ['Condo', 'Townhome'],
        whenStart: '2026-11-01',
        whenEnd: '2026-12-01',
      }).success,
    ).toBe(true);
  });

  it.each([
    ['an unknown intent', { ...valid, intent: 'sell' }, 'intent'],
    ['no places', { ...valid, places: [] }, 'places'],
    ['six places', { ...valid, places: Array(6).fill(place) }, 'places'],
    [
      'a neighborhood place',
      { ...valid, places: [{ kind: 'neighborhood', state: 'VA', name: 'Old Town' }] },
      'places.0.kind',
    ],
    ['a zip place with no zip', { ...valid, places: [{ ...place, kind: 'zip' }] }, 'places.0.zip'],
    ['a price range reversed', { ...valid, priceMin: 5, priceMax: 4 }, 'priceMax'],
    ['a negative price', { ...valid, priceMin: -1 }, 'priceMin'],
    ['too many beds', { ...valid, bedsMin: 21 }, 'bedsMin'],
    ['a repeated home type', { ...valid, homeTypes: ['Condo', 'Condo'] }, 'homeTypes'],
    ['an unknown home type', { ...valid, homeTypes: ['Castle'] }, 'homeTypes.0'],
    ['an end date with no start', { ...valid, whenEnd: '2026-12-01' }, 'whenEnd'],
    [
      'an end before the start',
      { ...valid, whenStart: '2026-12-02', whenEnd: '2026-12-01' },
      'whenEnd',
    ],
    ['a day that does not exist', { ...valid, whenStart: '2026-02-30' }, 'whenStart'],
    ['an unknown key', { ...valid, accountId: 'x' }, ''],
  ])('refuses %s', (_name, input, path) => {
    expect(refusedPaths(input)).toContain(path);
  });

  it('publishes the routes with sign-in required', () => {
    const doc: any = toOpenApiDocument();
    expect(doc.paths['/looking-for'].get.responses['401']).toBeDefined();
    expect(doc.paths['/looking-for/{id}'].put.responses['409']).toBeDefined();
    expect(doc.paths['/looking-for/{id}'].delete.responses['401']).toBeDefined();
  });
});
