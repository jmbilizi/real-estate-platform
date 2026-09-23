import { searchRequestSchema } from '@cribstop/property-contracts';

import { areaOf, createAreaLoader } from './on-demand';

const request = (input: Record<string, string>) => searchRequestSchema.parse(input);

describe('areaOf', () => {
  it('reads a ZIP from zip or from a five-digit query', () => {
    expect(areaOf(request({ zip: '20910' }))).toEqual({ zip: '20910' });
    expect(areaOf(request({ query: '20910' }))).toEqual({ zip: '20910' });
  });

  it('title-cases a city from city or from a place-shaped query', () => {
    expect(areaOf(request({ city: 'silver spring', state: 'md' }))).toEqual({
      city: 'Silver Spring',
      state: 'MD',
    });
    expect(areaOf(request({ query: 'WINSTON-SALEM' }))).toEqual({ city: 'Winston-Salem' });
  });

  it('returns null for a query that is not a place', () => {
    expect(areaOf(request({ query: '123 Main St #4' }))).toBeNull();
    expect(areaOf(request({}))).toBeNull();
  });
});

describe('createAreaLoader', () => {
  it('skips every load when Bright is not configured', async () => {
    const loader = createAreaLoader({ env: {}, log: () => undefined });

    await expect(loader.load(request({ query: 'Rockville' }))).resolves.toBe('skipped');
  });
});
