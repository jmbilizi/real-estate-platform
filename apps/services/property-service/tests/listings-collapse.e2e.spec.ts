import axios from 'axios';
import {
  type ListingCardRow,
  listingDetailSchema,
  listingsEnvelopeSchema,
  mapResponseSchema,
  neighborhoodsResponseSchema,
} from '@cribstop/property-contracts';
import { closePool, getPool } from '../src/db/pool';
import {
  COLLAPSE_CITY,
  COLLAPSE_STATE,
  type HomeInput,
  removeCollapseFixtures,
  type SeededHome,
  seedHomes,
  setRecordFacts,
  takeDown,
} from './support/collapse-fixtures';

/**
 * #716. One card per home, against a REAL service and a REAL database. Every home below sits in a
 * city that no other fixture uses, so each assertion reads that city only.
 *
 * `expected` is the card count of each home. The suite derives the city totals from it.
 */

const LOW = '00000000-0000-4000-8000-000000000001';
const HIGH = '00000000-0000-4000-8000-000000000002';
const OLD = '2026-09-18T00:00:00.000Z';
const NEW = '2026-10-03T00:00:00.000Z';

const HOMES: (HomeInput & { expected: number })[] = [
  {
    // The 213 Montgomery St case from the ticket: same office, a relist at a new price and broker.
    street: '213 Montgomery St',
    expected: 1,
    records: [
      { listedAt: OLD, listPrice: 2000000, broker: 'E2E Fixture Old Broker', mlsNumber: 'VAAX1' },
      { listedAt: NEW, listPrice: 1900000, broker: 'E2E Fixture New Broker', mlsNumber: 'VAAX2' },
    ],
  },
  {
    street: '1 Listed Rule Ln',
    expected: 1,
    records: [{ listedAt: OLD }, { listedAt: NEW }],
  },
  {
    // The 9-group case: an older Active record and a newer Pending record.
    street: '2 Pending Rule Ln',
    expected: 1,
    records: [
      { listedAt: OLD, status: 'Active' },
      { listedAt: NEW, status: 'Pending' },
    ],
  },
  {
    street: '3 Status Rule Ln',
    expected: 1,
    records: [
      { listedAt: OLD, status: 'Pending' },
      { listedAt: OLD, status: 'Active' },
      { listedAt: OLD, status: 'Coming Soon' },
    ],
  },
  {
    street: '4 Modified Rule Ln',
    expected: 1,
    records: [
      { listedAt: OLD, modifiedAt: '2026-10-01T00:00:00.000Z' },
      { listedAt: OLD, modifiedAt: '2026-10-05T00:00:00.000Z' },
    ],
  },
  {
    street: '5 Tie Rule Ln',
    expected: 1,
    records: [
      { id: LOW, listedAt: OLD },
      { id: HIGH, listedAt: OLD },
    ],
  },
  {
    street: '0 Zero Rd',
    expected: 2,
    records: [{ listedAt: OLD }, { listedAt: NEW }],
  },
  {
    street: '00 Double Zero Rd',
    expected: 2,
    records: [{ listedAt: OLD }, { listedAt: NEW }],
  },
  {
    street: '6 Lot 26 Holly St',
    expected: 2,
    records: [{ listedAt: OLD }, { listedAt: NEW }],
  },
  {
    street: '7 Parcel Way',
    expected: 2,
    records: [{ listedAt: OLD }, { listedAt: NEW }],
  },
  {
    street: '8 Acre Rd',
    propertyType: 'Land',
    expected: 2,
    records: [{ listedAt: OLD }, { listedAt: NEW }],
  },
  {
    street: '9 Condo Ct',
    propertyType: 'Condo',
    expected: 2,
    records: [{ listedAt: OLD }, { listedAt: NEW }],
  },
  {
    street: '10 Multi Ct',
    propertyType: 'Multi-Family',
    expected: 2,
    records: [{ listedAt: OLD }, { listedAt: NEW }],
  },
  {
    street: '11 Same Unit Ct',
    propertyType: 'Condo',
    units: ['1A'],
    expected: 1,
    records: [
      { listedAt: OLD, unit: 0 },
      { listedAt: NEW, unit: 0 },
    ],
  },
  {
    street: '12 Two Unit Ct',
    propertyType: 'Condo',
    units: ['1A', '1B'],
    expected: 2,
    records: [
      { listedAt: OLD, unit: 0 },
      { listedAt: NEW, unit: 1 },
    ],
  },
  {
    street: '13 Office Rd',
    expected: 3,
    records: [
      { listedAt: OLD, office: 'E2E Fixture Office A' },
      { listedAt: NEW, office: 'E2E Fixture Office A' },
      { listedAt: NEW, office: 'E2E Fixture Office B' },
    ],
  },
  {
    street: '14 Rent Rd',
    expected: 2,
    records: [
      { listedAt: OLD, offerKind: 'sale' },
      { listedAt: NEW, offerKind: 'rent', listPrice: 3000 },
    ],
  },
  {
    street: '106 Comanche Cir',
    expected: 2,
    records: [
      { listedAt: OLD, listPrice: 125000 },
      { listedAt: NEW, listPrice: 475000 },
    ],
  },
  {
    street: '15 Beds Rd',
    expected: 2,
    records: [{ listedAt: OLD }, { listedAt: NEW }],
  },
  {
    street: '16 Close Area Rd',
    expected: 1,
    records: [{ listedAt: OLD }, { listedAt: NEW }],
  },
  {
    street: '17 Far Area Rd',
    expected: 2,
    records: [{ listedAt: OLD }, { listedAt: NEW }],
  },
  {
    // The newer record is off-market, so it never wins and never counts.
    street: '18 Fresh Rd',
    expected: 1,
    records: [{ listedAt: OLD }, { listedAt: NEW, status: null }],
  },
  {
    street: '19 Since Rd',
    expected: 1,
    records: [{ listedAt: '2026-08-01T00:00:00.000Z' }, { listedAt: NEW, daysOnMarket: null }],
  },
  {
    // The older record withholds its address. The newer one shows it. They stay merged as one home.
    street: '21 Hidden Rd',
    expected: 1,
    records: [{ listedAt: OLD, addressHidden: true }, { listedAt: NEW }],
  },
  {
    street: '20 Takedown Rd',
    expected: 1,
    records: [{ listedAt: OLD }, { listedAt: NEW }],
  },
];

const ALL_LIVE = 'Active,Coming Soon,Pending';
let seeded: Record<string, SeededHome>;
const pool = getPool();

async function fetchPage(
  params: Record<string, unknown>,
): Promise<{ results: ListingCardRow[]; total: number; pageCount: number }> {
  const response = await axios.get('/listings', {
    params: { city: COLLAPSE_CITY, state: COLLAPSE_STATE, status: ALL_LIVE, ...params },
  });
  return listingsEnvelopeSchema.parse(response.data);
}

async function fetchAll(params: Record<string, unknown> = {}): Promise<ListingCardRow[]> {
  return (await fetchPage({ pageSize: 100, ...params })).results;
}

const homeOf = (street: string): SeededHome => {
  const home = seeded[street];
  if (!home) {
    throw new Error(`No seeded home: ${street}`);
  }
  return home;
};

const idAt = (street: string, index: number): string => {
  const id = homeOf(street).ids[index];
  if (!id) {
    throw new Error(`No record ${index} for ${street}`);
  }
  return id;
};

const cardsOf = (results: ListingCardRow[], street: string): ListingCardRow[] =>
  results.filter((card) => homeOf(street).ids.includes(card.id));

const idsOf = (cards: ListingCardRow[]): string[] => cards.map((card) => card.id).sort();

beforeAll(async () => {
  seeded = await seedHomes(pool, HOMES);
  await setRecordFacts(pool, idAt('15 Beds Rd', 1), { beds: 5 });
  await setRecordFacts(pool, idAt('16 Close Area Rd', 1), { livingSqft: 1700 });
  await setRecordFacts(pool, idAt('17 Far Area Rd', 1), { livingSqft: 1500 });
});

afterAll(async () => {
  await removeCollapseFixtures(pool);
  await closePool();
});

describe('one card per home (#716)', () => {
  it('shows the two 213 Montgomery St records as one card, the newest, with its own price and brokerage', async () => {
    const cards = cardsOf(await fetchAll(), '213 Montgomery St');

    expect(cards).toHaveLength(1);
    expect(cards[0]?.id).toBe(idAt('213 Montgomery St', 1));
    expect(cards[0]?.price).toBe(1900000);
    expect(cards[0]?.brokerName).toBe('E2E Fixture New Broker');
  });

  describe('winner order', () => {
    it('the latest listed_at wins', async () => {
      const cards = cardsOf(await fetchAll(), '1 Listed Rule Ln');
      expect(idsOf(cards)).toEqual([idAt('1 Listed Rule Ln', 1)]);
    });

    it('a newer Pending record beats an older Active record', async () => {
      const cards = cardsOf(await fetchAll(), '2 Pending Rule Ln');
      expect(idsOf(cards)).toEqual([idAt('2 Pending Rule Ln', 1)]);
      expect(cards[0]?.status).toBe('Pending');
    });

    it('on one list date, Active beats Coming Soon beats Pending', async () => {
      const cards = cardsOf(await fetchAll(), '3 Status Rule Ln');
      expect(idsOf(cards)).toEqual([idAt('3 Status Rule Ln', 1)]);
      expect(cards[0]?.status).toBe('Active');
    });

    it('on one list date and status, the latest MLS modification wins', async () => {
      const cards = cardsOf(await fetchAll(), '4 Modified Rule Ln');
      expect(idsOf(cards)).toEqual([idAt('4 Modified Rule Ln', 1)]);
    });

    it('on a full tie, the greater id wins', async () => {
      const cards = cardsOf(await fetchAll(), '5 Tie Rule Ln');
      expect(idsOf(cards)).toEqual([HIGH]);
    });
  });

  describe('never merges', () => {
    it.each([
      ['a street number of 0', '0 Zero Rd'],
      ['a street number of 00', '00 Double Zero Rd'],
      ['a street line with "Lot"', '6 Lot 26 Holly St'],
      ['a street line with "Parcel"', '7 Parcel Way'],
      ['the Land type', '8 Acre Rd'],
      ['Condo records with no unit', '9 Condo Ct'],
      ['Multi-Family records with no unit', '10 Multi Ct'],
      ['different units', '12 Two Unit Ct'],
      ['records of more than one office', '13 Office Rd'],
      ['a sale and a rental', '14 Rent Rd'],
      ['prices more than 2x apart', '106 Comanche Cir'],
      ['different beds', '15 Beds Rd'],
      ['living areas more than 10% apart', '17 Far Area Rd'],
    ])('keeps every record of a home with %s', async (_rule, street) => {
      const cards = cardsOf(await fetchAll(), street);
      expect(idsOf(cards)).toEqual([...homeOf(street).ids].sort());
    });

    it('merges Condo records that name the same unit', async () => {
      expect(cardsOf(await fetchAll(), '11 Same Unit Ct')).toHaveLength(1);
    });

    it('merges living areas within 10%', async () => {
      expect(cardsOf(await fetchAll(), '16 Close Area Rd')).toHaveLength(1);
    });
  });

  it('gives every home at least one card and counts the merged groups', async () => {
    const results = await fetchAll();
    for (const home of HOMES) {
      expect(cardsOf(results, home.street)).toHaveLength(home.expected);
    }
    expect(results).toHaveLength(HOMES.reduce((sum, home) => sum + home.expected, 0));
  });

  it('counts homes in the total, the page count and every page size', async () => {
    const expected = HOMES.reduce((sum, home) => sum + home.expected, 0);
    for (const pageSize of [1, 3, 7, 100]) {
      const first = await fetchPage({ pageSize, page: 1 });
      expect(first.total).toBe(expected);
      expect(first.pageCount).toBe(Math.ceil(expected / pageSize));
      const seen = new Set<string>();
      for (let page = 1; page <= first.pageCount; page += 1) {
        for (const card of (await fetchPage({ pageSize, page })).results) {
          expect(seen.has(card.id)).toBe(false);
          seen.add(card.id);
        }
      }
      expect(seen.size).toBe(expected);
    }
  });

  it('counts homes in the map pins and the map total', async () => {
    const expected = HOMES.reduce((sum, home) => sum + home.expected, 0);
    const response = await axios.get('/listings/map', {
      params: { bounds: '20,20,21,21', status: ALL_LIVE },
    });
    const body = mapResponseSchema.parse(response.data);
    expect(body.pins).toHaveLength(expected);
    expect(body.total).toBe(expected);
  });

  it('counts homes in the neighborhood count, equal to the search total', async () => {
    const search = await fetchPage({ pageSize: 1 });
    const response = await axios.get('/listings/neighborhoods', {
      params: { city: COLLAPSE_CITY, state: COLLAPSE_STATE, status: ALL_LIVE, minCount: 1 },
    });
    const body = neighborhoodsResponseSchema.parse(response.data);

    expect(body.results.reduce((sum, row) => sum + row.total, 0)).toBe(search.total);
  });

  describe('merged records', () => {
    it('opens a hidden record at its own URL with its own data', async () => {
      const hiddenId = idAt('213 Montgomery St', 0);
      const response = await axios.get(`/listings/${hiddenId}`);
      const detail = listingDetailSchema.parse(response.data);

      expect(detail.listing.id).toBe(hiddenId);
      expect(detail.listing.price).toBe(2000000);
      expect(detail.listing.brokerName).toBe('E2E Fixture Old Broker');
    });

    it('lists the other live records on the winner detail', async () => {
      const hiddenId = idAt('213 Montgomery St', 0);
      const winnerId = idAt('213 Montgomery St', 1);
      const response = await axios.get(`/listings/${winnerId}`);
      const detail = listingDetailSchema.parse(response.data);

      expect(detail.listing.alsoListedAs).toEqual([{ id: hiddenId, mlsNumber: 'VAAX1' }]);
    });

    it('never ties a record that shows its address to one that withholds it', async () => {
      const shown = listingDetailSchema.parse(
        (await axios.get(`/listings/${idAt('21 Hidden Rd', 1)}`)).data,
      );
      const hidden = listingDetailSchema.parse(
        (await axios.get(`/listings/${idAt('21 Hidden Rd', 0)}`)).data,
      );

      expect(shown.listing.alsoListedAs).toEqual([]);
      expect(hidden.listing.alsoListedAs).toEqual([]);
    });

    it('lists nothing for a home with one record', async () => {
      const response = await axios.get(`/listings/${idAt('0 Zero Rd', 0)}`);
      expect(listingDetailSchema.parse(response.data).listing.alsoListedAs).toEqual([]);
    });

    it('reports the oldest list date of the home as listedSince', async () => {
      const response = await axios.get(`/listings/${idAt('19 Since Rd', 1)}`);
      const detail = listingDetailSchema.parse(response.data);

      expect(detail.listing.daysOnMarket).toBeNull();
      expect(detail.listing.listedSince).toBe('2026-08-01T00:00:00.000Z');
    });
  });

  describe('freshness', () => {
    it('never counts an off-market record, and never lets it win', async () => {
      const cards = cardsOf(await fetchAll(), '18 Fresh Rd');
      expect(idsOf(cards)).toEqual([idAt('18 Fresh Rd', 0)]);
    });

    it('promotes the next live record when the winner goes off-market', async () => {
      const older = idAt('20 Takedown Rd', 0);
      const newer = idAt('20 Takedown Rd', 1);
      expect(idsOf(cardsOf(await fetchAll(), '20 Takedown Rd'))).toEqual([newer]);

      await takeDown(pool, newer);

      expect(idsOf(cardsOf(await fetchAll(), '20 Takedown Rd'))).toEqual([older]);
    });
  });
});
