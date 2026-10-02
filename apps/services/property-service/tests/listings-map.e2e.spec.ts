import axios from 'axios';
import { MAP_PIN_CAP_DEFAULT, mapResponseSchema } from '@cribstop/property-contracts';
import { complianceFixtureIds } from './support/fixture-ids';

/**
 * `GET /listings/map` (#546) against a REAL service and REAL database, with the guarded compliance
 * fixtures. Fixture rows sit at latitude 0, longitude 0. The suppressed-address row stores
 * 11.111111, -155.555555, which the view masks to NULL.
 */
const fixtures = complianceFixtureIds();

const AROUND_FIXTURES = '-1,-1,1,1';
const AROUND_SUPPRESSED_COORDINATES = '-156,11,-155,12';

describe('GET /listings/map', () => {
  it('returns individual points and a total, never clusters', async () => {
    const response = await axios.get('/listings/map', { params: { bounds: AROUND_FIXTURES } });
    const body = mapResponseSchema.parse(response.data);

    expect(Object.keys(response.data).sort()).toEqual(['pins', 'sampleCount', 'total']);
    expect(body.pins.length).toBeGreaterThan(0);
    expect(body.pins.length).toBeLessThanOrEqual(MAP_PIN_CAP_DEFAULT);
    expect(body.total).toBeGreaterThanOrEqual(body.pins.length);
    expect(body.pins.some((pin) => pin.id === fixtures.sampleListingId)).toBe(true);
    for (const pin of body.pins) {
      expect(Object.keys(pin).sort()).toEqual(
        ['id', 'latitude', 'listingType', 'longitude', 'price', 'status'].sort(),
      );
    }
  });

  it('gives a listing whose address display is not allowed no pin and no count', async () => {
    const around = await axios.get('/listings/map', {
      params: { bounds: AROUND_SUPPRESSED_COORDINATES },
    });
    const everywhere = await axios.get('/listings/map', {
      params: { bounds: '-179,-89,179,89' },
    });

    expect(mapResponseSchema.parse(around.data)).toMatchObject({ total: 0, pins: [] });
    const { pins } = mapResponseSchema.parse(everywhere.data);
    expect(pins.some((pin) => pin.id === fixtures.suppressedAddressListingId)).toBe(false);
    expect(
      pins.some(
        (pin) =>
          pin.latitude === fixtures.suppressedAddressLatitude ||
          pin.longitude === fixtures.suppressedAddressLongitude,
      ),
    ).toBe(false);
  });

  it('carries a null price for a price withheld listing, never a stored figure', async () => {
    const response = await axios.get('/listings/map', { params: { bounds: AROUND_FIXTURES } });
    const { pins } = mapResponseSchema.parse(response.data);
    const pin = pins.find((p) => p.id === fixtures.suppressedPriceListingId);

    expect(pin).toBeDefined();
    expect(pin?.price).toBeNull();
  });

  it('rejects the retired zoom parameter', async () => {
    const response = await axios.get('/listings/map', {
      params: { bounds: AROUND_FIXTURES, zoom: '12' },
      validateStatus: () => true,
    });

    expect(response.status).toBe(400);
  });
});
