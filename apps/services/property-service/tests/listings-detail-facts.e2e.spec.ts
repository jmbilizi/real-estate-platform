import axios from 'axios';
import { listingDetailSchema } from '@cribstop/property-contracts';
import { closePool, getPool } from '../src/db/pool';
import { replaceListingFacts } from '../src/db/write';
import { complianceFixtureIds } from './support/fixture-ids';

/**
 * #564 detail facts against a real database. The unit specs use a fake client, so only this suite
 * runs the detail SQL with populated tax, HOA, tour, agent, fact and caption values.
 */
const id = complianceFixtureIds().sampleListingId;

afterAll(async () => {
  await closePool();
});

async function reset(): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE listings SET tax_annual_amount = NULL, tax_year = NULL, hoa_fee = NULL,
       hoa_fee_frequency = NULL, virtual_tour_url = NULL, list_agent_phone = NULL,
       list_agent_email = NULL WHERE id = $1`,
    [id],
  );
  await pool.query('DELETE FROM listing_facts WHERE listing_id = $1', [id]);
  await pool.query('UPDATE listing_media SET caption = NULL WHERE listing_id = $1', [id]);
}

describe('GET /listings/:id with #564 values', () => {
  afterEach(reset);

  it('serves populated detail facts, written through the sync helper', async () => {
    await getPool().query(
      `UPDATE listings SET tax_annual_amount = 5120.5, tax_year = 2025, hoa_fee = 310,
         hoa_fee_frequency = 'Monthly', virtual_tour_url = 'https://tours.example/abc?x=1',
         list_agent_phone = '2025550100', list_agent_email = 'agent@example.com'
       WHERE id = $1`,
      [id],
    );
    await replaceListingFacts(getPool(), id, { parking: ['Driveway', 'Off Street'] });
    await getPool().query('UPDATE listing_media SET caption = $2 WHERE listing_id = $1', [
      id,
      'Front "elevation" é',
    ]);

    const response = await axios.get(`/listings/${id}`);
    const { listing } = listingDetailSchema.parse(response.data);

    expect(response.status).toBe(200);
    expect(listing.taxAnnualAmount).toBe(5120.5);
    expect(listing.virtualTourUrl).toBe('https://tours.example/abc?x=1');
    expect(listing.facts.parking).toEqual(['Driveway', 'Off Street']);
  });

  it('answers 200 with null fields when the stored tour URL and email are malformed', async () => {
    await getPool().query(
      `UPDATE listings SET tax_annual_amount = 100, virtual_tour_url = 'not a url',
         list_agent_email = 'a b@@example' WHERE id = $1`,
      [id],
    );

    const response = await axios.get(`/listings/${id}`);
    const { listing } = listingDetailSchema.parse(response.data);

    expect(response.status).toBe(200);
    expect(listing.virtualTourUrl).toBeNull();
    expect(listing.listAgentEmail).toBeNull();
    expect(listing.taxAnnualAmount).toBe(100);
  });
});
