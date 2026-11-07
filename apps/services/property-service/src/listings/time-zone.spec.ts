import { deriveTimeZone } from './time-zone';

const at = (state: string, latitude: number, longitude: number, zip = '') =>
  deriveTimeZone({ state, zip, latitude, longitude });
const byZip = (state: string, zip: string) =>
  deriveTimeZone({ state, zip, latitude: null, longitude: null });

describe('deriveTimeZone (#983)', () => {
  it('puts El Paso in Mountain time', () => {
    expect(at('TX', 31.76, -106.49)).toBe('America/Denver');
  });

  it('leaves the rest of Texas to the state table', () => {
    expect(at('TX', 29.76, -95.37)).toBeUndefined();
    expect(at('TX', 31.0, -104.83)).toBeUndefined();
  });

  it('puts the Florida panhandle west of the Apalachicola in Central time', () => {
    expect(at('FL', 30.42, -87.22)).toBe('America/Chicago');
    expect(at('FL', 30.18, -85.8)).toBe('America/Chicago');
    expect(at('FL', 30.77, -85.23)).toBe('America/Chicago');
  });

  it('leaves the rest of Florida to the state table', () => {
    expect(at('FL', 25.76, -80.19)).toBeUndefined();
    expect(at('FL', 30.33, -81.66)).toBeUndefined();
    expect(at('FL', 29.81, -85.3)).toBeUndefined();
  });

  it.each([
    ['MI', 46.55, -90.4, 'America/Chicago'],
    ['MI', 42.33, -83.05, undefined],
    ['KS', 39.35, -101.71, 'America/Denver'],
    ['KS', 39.05, -95.68, undefined],
    ['NE', 41.86, -103.66, 'America/Denver'],
    ['NE', 41.26, -95.93, undefined],
    ['SD', 44.08, -103.23, 'America/Denver'],
    ['SD', 43.55, -96.73, undefined],
    ['OR', 44.03, -116.96, 'America/Boise'],
    ['OR', 45.52, -122.68, undefined],
    ['ID', 47.68, -116.78, 'America/Los_Angeles'],
    ['ID', 43.62, -116.2, undefined],
    ['NV', 40.74, -114.07, 'America/Denver'],
    ['NV', 36.17, -115.14, undefined],
  ])('%s at %f, %f resolves to %s', (state, lat, lng, zone) => {
    expect(at(state, lat, lng)).toBe(zone);
  });

  it('falls back to the ZIP prefix when there are no coordinates', () => {
    expect(byZip('TX', '79912')).toBe('America/Denver');
    expect(byZip('TX', '88520')).toBe('America/Denver');
    expect(byZip('TX', '77002')).toBeUndefined();
    expect(byZip('FL', '32502')).toBe('America/Chicago');
    expect(byZip('FL', '32407')).toBe('America/Chicago');
    expect(byZip('FL', '33101')).toBeUndefined();
  });

  it('prefers the coordinates over the ZIP', () => {
    expect(at('TX', 29.76, -95.37, '79912')).toBeUndefined();
  });

  it('returns no zone with no coordinates and no matching ZIP', () => {
    expect(byZip('TX', '')).toBeUndefined();
    expect(byZip('MD', '21201')).toBeUndefined();
    expect(byZip('ZZ', '00000')).toBeUndefined();
  });

  it('reads the state without case or spacing', () => {
    expect(at(' tx ', 31.76, -106.49)).toBe('America/Denver');
  });
});
