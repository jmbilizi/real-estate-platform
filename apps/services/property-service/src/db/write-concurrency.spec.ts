import { getOrCreateProperty, getOrCreateUnit, Queryable } from './write';
import { PropertyRow, UnitRow } from './types';

/**
 * Two Bright sync slices can map a record for the same building or the same unit at the same time
 * (#359): a concurrent-apply pipeline no longer guarantees one slice's writes finish before the
 * next slice's start. `getOrCreateProperty`/`getOrCreateUnit` rely on a real unique index plus
 * `ON CONFLICT ... DO UPDATE ... RETURNING id` for that case, which a fake `Queryable` cannot
 * exercise directly. What these fakes CAN, and do, model is the outcome that guarantee produces:
 * two concurrent inserts against the same key serialize (as a real unique index does) and the
 * second sees the first's row instead of erroring or minting a second one.
 */

function fakePropertiesTable(): { client: Queryable; rowCount: () => number } {
  const rows = new Map<string, string>(); // address_key -> id
  let queue: Promise<void> = Promise.resolve();
  const client: Queryable = {
    async query(sql, params = []) {
      if (!sql.includes('INSERT INTO properties')) {
        return { rows: [] };
      }
      const myTurn = queue;
      let release = (): void => undefined;
      queue = new Promise((resolve) => {
        release = resolve;
      });
      await myTurn;
      try {
        const id = params[0] as string;
        const addressKey = params[7] as string;
        const existing = rows.get(addressKey);
        if (existing !== undefined) {
          return { rows: [{ id: existing }] };
        }
        rows.set(addressKey, id);
        return { rows: [{ id }] };
      } finally {
        release();
      }
    },
  };
  return { client, rowCount: () => rows.size };
}

function fakeUnitsTable(): { client: Queryable; rowCount: () => number } {
  const rows = new Map<string, string>(); // `${property_id}::${unit_number}` -> id
  let queue: Promise<void> = Promise.resolve();
  const client: Queryable = {
    async query(sql, params = []) {
      if (!sql.includes('INSERT INTO units')) {
        return { rows: [] };
      }
      const myTurn = queue;
      let release = (): void => undefined;
      queue = new Promise((resolve) => {
        release = resolve;
      });
      await myTurn;
      try {
        const id = params[0] as string;
        const propertyId = params[1] as string;
        const unitNumber = params[2] as string | null;
        const key = `${propertyId}::${String(unitNumber)}`;
        const existing = rows.get(key);
        if (existing !== undefined) {
          return { rows: [{ id: existing }] };
        }
        rows.set(key, id);
        return { rows: [{ id }] };
      } finally {
        release();
      }
    },
  };
  return { client, rowCount: () => rows.size };
}

const baseProperty: Omit<PropertyRow, 'id' | 'address_key'> = {
  community_id: null,
  address_raw: '142 Oak St, Arlington, VA 22201',
  street_line: '142 Oak St',
  city: 'Arlington',
  state: 'VA',
  zip5: '22201',
  latitude: null,
  longitude: null,
  neighborhood: null,
  property_type: 'Single Family',
  year_built: null,
  lot_sqft: null,
  beds: null,
  baths_full: null,
  baths_half: null,
  living_sqft: null,
  is_sample: true,
};

describe('concurrent property and unit creation (#359)', () => {
  it('dedups two slices creating the same property at once to one row and one id', async () => {
    const { client, rowCount } = fakePropertiesTable();
    const rowA: PropertyRow = { ...baseProperty, id: 'property-a', address_key: 'addr-142-oak' };
    const rowB: PropertyRow = { ...baseProperty, id: 'property-b', address_key: 'addr-142-oak' };

    const [idA, idB] = await Promise.all([
      getOrCreateProperty(client, rowA),
      getOrCreateProperty(client, rowB),
    ]);

    expect(idA).toBe(idB);
    expect(rowCount()).toBe(1);
  });

  it('dedups two slices creating the same unit at once to one row and one id', async () => {
    const { client, rowCount } = fakeUnitsTable();
    const rowA: UnitRow = {
      id: 'unit-a',
      property_id: 'property-1',
      unit_number: '4B',
      floor: 4,
      beds: 1,
      baths_full: 1,
      baths_half: 0,
      living_sqft: 700,
      is_sample: true,
    };
    const rowB: UnitRow = { ...rowA, id: 'unit-b' };

    const [idA, idB] = await Promise.all([
      getOrCreateUnit(client, rowA),
      getOrCreateUnit(client, rowB),
    ]);

    expect(idA).toBe(idB);
    expect(rowCount()).toBe(1);
  });
});
