import { Queryable } from '../../db/write';

import { mapStagedBrightProperties } from './run';

/**
 * A minimal in-memory stand-in for the four tables this pass touches. Not a query planner: it
 * recognises the handful of statements `write.ts` and `run.ts` actually issue, by substring, and
 * keeps just enough state (properties keyed by address_key, listings keyed by id and by
 * (source_system, source_listing_key)) to prove idempotency across two passes over the same batch.
 */
function createFakeDb(options: {
  stagedPayloads: Record<string, unknown>[];
  statuses?: Record<string, unknown>[];
}): { client: Queryable; listings: () => Record<string, unknown>[] } {
  const properties = new Map<string, Record<string, unknown>>(); // address_key -> row
  const listings = new Map<string, Record<string, unknown>>(); // id -> row
  const statuses = options.statuses ?? [
    { code: 'Active', consumer_status: 'Active', is_terminal: false, reso_standard_status: 'Active' },
    { code: 'Closed', consumer_status: 'Sold', is_terminal: true, reso_standard_status: 'Closed' },
    { code: 'Withdrawn', consumer_status: null, is_terminal: true, reso_standard_status: 'Withdrawn' },
  ];

  const client: Queryable = {
    query: async (text: string, values: unknown[] = []) => {
      if (text.includes('FROM bright_staging_records')) {
        return {
          rows: options.stagedPayloads.map((payload, index) => ({
            record_key: `key-${index}`,
            payload,
          })),
        };
      }
      if (text.includes('FROM listing_statuses')) {
        return { rows: statuses };
      }
      if (text.includes('INSERT INTO properties')) {
        const [id, , , , , , , addressKey] = values;
        const existing = properties.get(String(addressKey));
        if (existing) {
          return { rows: [{ id: existing.id }] };
        }
        const row = { id, address_key: addressKey };
        properties.set(String(addressKey), row);
        return { rows: [{ id }] };
      }
      if (text.includes('INSERT INTO units')) {
        const [id] = values;
        return { rows: [{ id }] };
      }
      if (text.includes('l.source_system')) {
        const [sourceSystem, sourceListingKey] = values;
        const match = [...listings.values()].find(
          (l) => l.source_system === sourceSystem && l.source_listing_key === sourceListingKey,
        );
        if (!match) {
          return { rows: [] };
        }
        const status = statuses.find((s) => s.code === match.status);
        return { rows: [{ id: match.id, is_terminal: status?.is_terminal ?? false }] };
      }
      if (text.includes('is_terminal') && text.includes('l.id = $1')) {
        const [id] = values;
        const match = listings.get(String(id));
        if (!match) {
          return { rows: [] };
        }
        const status = statuses.find((s) => s.code === match.status);
        return { rows: [{ is_terminal: status?.is_terminal ?? false }] };
      }
      if (text.includes('FROM properties p')) {
        return {
          rows: [
            {
              beds: null,
              baths_full: null,
              baths_half: null,
              living_sqft: null,
              lot_sqft: null,
              year_built: null,
              neighborhood: null,
              city: 'Arlington',
              state: 'VA',
              zip5: '22201',
              latitude: null,
              longitude: null,
              is_sample: true,
            },
          ],
        };
      }
      if (text.includes('INSERT INTO listings')) {
        const [id, propertyId, unitId, title, offerKind, consumerStatus, status, source, sourceSystem, sourceListingKey] =
          values;
        listings.set(String(id), {
          id,
          propertyId,
          unitId,
          title,
          offerKind,
          consumer_status: consumerStatus,
          status,
          source,
          source_system: sourceSystem,
          source_listing_key: sourceListingKey,
        });
        return { rows: [] };
      }
      if (text.includes('INSERT INTO listing_events')) {
        return { rows: [] };
      }
      return { rows: [] };
    },
  };

  return { client, listings: () => [...listings.values()] };
}

const ACTIVE_PAYLOAD = {
  ListingKey: 'BR-1',
  UnparsedAddress: '123 Oak St',
  City: 'Arlington',
  StateOrProvince: 'VA',
  PostalCode: '22201',
  ListPrice: 500000,
  PropertySubType: 'Detached',
  StandardStatus: 'Active',
  ListOfficeName: 'Acme Realty',
  ListOfficePhone: '2025551234',
  ListOfficeEmail: 'office@acme.example',
};

describe('mapStagedBrightProperties', () => {
  it('reports zero work when nothing is staged', async () => {
    const { client } = createFakeDb({ stagedPayloads: [] });
    const report = await mapStagedBrightProperties(client, { feed: 'test', soldDisplayDelayDays: null });
    expect(report.staged).toBe(0);
    expect(report.mapped).toBe(0);
  });

  it('maps a publishable record and counts it as published and sample-marked on the test feed', async () => {
    const { client, listings } = createFakeDb({ stagedPayloads: [ACTIVE_PAYLOAD] });

    const report = await mapStagedBrightProperties(client, {
      feed: 'test',
      soldDisplayDelayDays: null,
    });

    expect(report.staged).toBe(1);
    expect(report.mapped).toBe(1);
    expect(report.sampleMarked).toBe(1);
    expect(listings()).toHaveLength(1);
  });

  it('counts a fail-closed record under withheldByReason and does not write it', async () => {
    const { client, listings } = createFakeDb({
      stagedPayloads: [{ ...ACTIVE_PAYLOAD, StandardStatus: 'Registered' }],
    });

    const report = await mapStagedBrightProperties(client, {
      feed: 'test',
      soldDisplayDelayDays: null,
    });

    expect(report.mapped).toBe(0);
    expect(report.withheld).toBe(1);
    expect(report.withheldByReason.unrecognized_status).toBe(1);
    expect(listings()).toHaveLength(0);
  });

  it('is idempotent: mapping the same staged batch twice writes exactly one listing', async () => {
    const { client, listings } = createFakeDb({ stagedPayloads: [ACTIVE_PAYLOAD] });

    await mapStagedBrightProperties(client, { feed: 'test', soldDisplayDelayDays: null });
    await mapStagedBrightProperties(client, { feed: 'test', soldDisplayDelayDays: null });

    expect(listings()).toHaveLength(1);
  });

  it('does not count a Withdrawn record as published, but does count it taken down', async () => {
    const { client } = createFakeDb({
      stagedPayloads: [{ ...ACTIVE_PAYLOAD, StandardStatus: 'Withdrawn' }],
    });

    const report = await mapStagedBrightProperties(client, {
      feed: 'test',
      soldDisplayDelayDays: null,
    });

    expect(report.mapped).toBe(1);
    expect(report.published).toBe(0);
    expect(report.takenDown).toBe(1);
  });
});
