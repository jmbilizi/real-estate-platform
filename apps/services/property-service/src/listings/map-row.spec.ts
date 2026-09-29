import { cardDbRowFixture } from './test-fixtures';
import { toListingCardRow, toListingDetail, toListingsMeta } from './map-row';

describe('NAR 7.58 contact-method floor (#344)', () => {
  it('serves a card with a phone and no email', () => {
    const row = toListingCardRow(
      cardDbRowFixture({ broker_phone: '2025551234', broker_email: null }),
    );
    expect(row.brokerPhone).toBe('2025551234');
    expect(row.brokerEmail).toBeNull();
  });

  it('serves a card with an email and no phone', () => {
    const row = toListingCardRow(
      cardDbRowFixture({ broker_phone: '', broker_email: 'office@acme.example' }),
    );
    expect(row.brokerPhone).toBe('');
    expect(row.brokerEmail).toBe('office@acme.example');
  });

  it('refuses to serve a card with neither a phone nor an email', () => {
    expect(() =>
      toListingCardRow(cardDbRowFixture({ broker_phone: '', broker_email: null })),
    ).toThrow(/neither a broker phone nor a broker email/);
  });

  it('refuses to serve a detail view with neither a phone nor an email', () => {
    expect(() =>
      toListingDetail(cardDbRowFixture({ broker_phone: '', broker_email: null })),
    ).toThrow(/neither a broker phone nor a broker email/);
  });
});

/**
 * The trap these tests exist for: `pg`'s per-column type parsers (`src/db/pool.ts`) apply to
 * top-level columns ONLY. Anything inside a `json`/`jsonb` payload is serialised by Postgres itself
 * and arrives as an already-decoded JS value, so a `timestamptz` nested in a `json_build_object`
 * reaches the mapper as a string in Postgres's own format — `2026-08-12T04:44:01.545038+00:00` —
 * rather than as a `Date`.
 *
 * The contract publishes `z.iso.datetime()`, which in Zod 4 accepts the `Z` form and REJECTS the
 * `+00:00` offset form. So a nested timestamp passed straight through fails the mapper's own
 * `.parse()` and becomes a 500 on the detail endpoint. The card path never hit this because it
 * converts explicitly via `instant()`; the detail's `openHouses[]` is the one place a timestamp is
 * nested in JSON.
 */

/** Exactly what `json_build_object('starts_at', oh.starts_at)` produces for a `timestamptz`. */
const PG_JSON_TIMESTAMP = '2026-08-12T04:44:01.545038+00:00';
const PG_JSON_TIMESTAMP_END = '2026-08-12T06:44:01.545038+00:00';

describe('toListingDetail', () => {
  it('normalises JSON-nested open-house timestamps to the ISO instant the contract publishes', () => {
    const detail = toListingDetail(
      cardDbRowFixture({
        open_houses: [
          { starts_at: PG_JSON_TIMESTAMP, ends_at: PG_JSON_TIMESTAMP_END, remarks: 'Front door' },
        ],
      }),
    );

    expect(detail.listing.openHouses).toEqual([
      {
        startsAt: '2026-08-12T04:44:01.545Z',
        endsAt: '2026-08-12T06:44:01.545Z',
        remarks: 'Front door',
      },
    ]);
  });

  it('preserves the instant, so a showing does not move when the format is normalised', () => {
    const detail = toListingDetail(
      cardDbRowFixture({
        open_houses: [
          { starts_at: PG_JSON_TIMESTAMP, ends_at: PG_JSON_TIMESTAMP_END, remarks: null },
        ],
      }),
    );

    expect(detail.listing.openHouses.map((occurrence) => Date.parse(occurrence.startsAt))).toEqual([
      Date.parse(PG_JSON_TIMESTAMP),
    ]);
  });

  it('emits an empty list rather than null when there is no upcoming occurrence', () => {
    expect(toListingDetail(cardDbRowFixture({ open_houses: null })).listing.openHouses).toEqual([]);
  });

  it('rejects a nested timestamp it cannot interpret instead of emitting a bad instant', () => {
    // `new Date('not a date')` is an Invalid Date whose `toISOString()` throws. Better a loud
    // failure than `null`/`"Invalid Date"` reaching the wire, which is the whole reason the mappers
    // end in `.parse()`.
    expect(() =>
      toListingDetail(
        cardDbRowFixture({
          open_houses: [
            { starts_at: 'not a timestamp', ends_at: PG_JSON_TIMESTAMP_END, remarks: null },
          ],
        }),
      ),
    ).toThrow();
  });
});

describe('toListingsMeta (#438)', () => {
  const baseRow = { data_updated_at: null, sources: null, listing_count: 0 };

  it('converts last_synced_at to the same ISO instant format as dataUpdatedAt', () => {
    const meta = toListingsMeta({ ...baseRow, last_synced_at: new Date('2026-09-28T10:00:00Z') });
    expect(meta.lastSyncedAt).toBe('2026-09-28T10:00:00.000Z');
  });

  it('reports lastSyncedAt as null when no sync run has succeeded yet', () => {
    const meta = toListingsMeta({ ...baseRow, last_synced_at: null });
    expect(meta.lastSyncedAt).toBeNull();
  });
});

describe('toListingCardRow', () => {
  it('still converts the view’s top-level open-house columns, which arrive as Date', () => {
    const card = toListingCardRow(
      cardDbRowFixture({
        open_house_starts_at: new Date('2026-08-12T04:44:01.545Z'),
        open_house_ends_at: new Date('2026-08-12T06:44:01.545Z'),
        open_house_remarks: 'Ring the bell',
      }),
    );

    expect(card.openHouse).toEqual({
      startsAt: '2026-08-12T04:44:01.545Z',
      endsAt: '2026-08-12T06:44:01.545Z',
      remarks: 'Ring the bell',
    });
  });
});

describe('listedAtPrecise (#459)', () => {
  it('serves the status change instant when it is on the list date with a real time', () => {
    const row = toListingCardRow(
      cardDbRowFixture({
        listed_at: new Date('2026-09-22T00:00:00.000Z'),
        status_changed_at: new Date('2026-09-22T04:16:22.000Z'),
      }),
    );
    expect(row.listedAtPrecise).toBe('2026-09-22T04:16:22.000Z');
  });

  it('serves null for a later status change, and when there is no status change', () => {
    const later = toListingCardRow(
      cardDbRowFixture({
        listed_at: new Date('2025-12-05T00:00:00.000Z'),
        status_changed_at: new Date('2026-09-22T04:16:22.000Z'),
      }),
    );
    const none = toListingCardRow(cardDbRowFixture({ status_changed_at: null }));
    expect(later.listedAtPrecise).toBeNull();
    expect(none.listedAtPrecise).toBeNull();
  });
});
