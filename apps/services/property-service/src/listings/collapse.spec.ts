import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { collapseCondition, LIVE_STATUSES, mergedRecordsLateral, VIEW_SUBJECT } from './collapse';
import { buildSearchQuery } from './search-query';
import { searchRequestSchema } from '@cribstop/property-contracts';

/**
 * The behaviour of the collapse needs a database. `tests/listings-collapse.e2e.spec.ts` covers it.
 * These tests guard the SQL text the unit suite can see.
 */

describe('collapseCondition', () => {
  const sql = collapseCondition();

  it('judges only live records and reads the live statuses from one list', () => {
    for (const status of LIVE_STATUSES) {
      expect(sql).toContain(`'${status}'`);
    }
    expect(sql).not.toContain("'Sold'");
  });

  it('keeps the index probe first, ORed with the full test, so Postgres probes per row', () => {
    expect(sql.indexOf('s.property_id')).toBeLessThan(sql.indexOf('o.property_id'));
    expect(sql).toMatch(/\)\s+OR NOT EXISTS/);
  });

  it('orders winners by listed_at, status, modification time, then id', () => {
    const order = sql.slice(sql.indexOf('COALESCE(o.listed_at'));
    const positions = [
      'COALESCE(o.listed_at',
      "WHEN 'Active' THEN 3 WHEN 'Coming Soon' THEN 2",
      'COALESCE(o.source_modification_timestamp',
      'o.id)',
    ].map((part) => order.indexOf(part));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('exempts lots and land through property_is_parcel, and never names street_line (#48)', () => {
    expect(sql).toContain('property_is_parcel(o.property_id)');
    expect(sql).not.toContain('street_line');
  });

  it('bounds price and area', () => {
    expect(sql).toContain('2 * ');
    expect(sql).toContain('0.1 * greatest');
  });

  it('requires the same unit, type and office, and a single office per home', () => {
    expect(sql).toContain('o.unit_id IS NOT DISTINCT FROM v.unit_id');
    expect(sql).toContain('o.listing_type = v.listing_type');
    expect(sql).toContain('o.office_name = v.office_name');
    expect(sql).toContain('x.office_name IS DISTINCT FROM v.office_name');
  });

  it('does not add a bind parameter', () => {
    expect(sql).not.toMatch(/\$\d/);
  });
});

describe('buildSearchQuery', () => {
  it('applies the collapse to every query, with no flag', () => {
    const { where } = buildSearchQuery(searchRequestSchema.parse({}));
    expect(where).toContain(collapseCondition(VIEW_SUBJECT));
  });
});

describe('mergedRecordsLateral', () => {
  it('treats a source_listing_id equal to the feed key as an unknown MLS number', () => {
    expect(mergedRecordsLateral()).toContain('NULLIF(o.source_listing_id, o.source_listing_key)');
  });
});

describe('migration 055', () => {
  it('indexes the same statuses as LIVE_STATUSES', () => {
    const migration = readFileSync(
      join(__dirname, '..', '..', 'migrations', '1785801600055_add-listing-collapse-support.js'),
      'utf8',
    );
    const listed = /consumer_status IN \(([^)]*)\)/.exec(migration)?.[1] ?? '';
    const statuses = [...listed.matchAll(/'([^']+)'/g)].map((match) => match[1]);
    expect(statuses).toEqual([...LIVE_STATUSES]);
  });
});
