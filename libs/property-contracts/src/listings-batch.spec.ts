import { LISTINGS_BATCH_MAX_ROWS, listingsBatchRequestSchema } from './listings-batch';

const row = { id: 'near-sale', params: { listingType: 'sale', city: 'Rockville' } };

describe('listingsBatchRequestSchema', () => {
  it('defaults widen to false and accepts repeated parameters', () => {
    const parsed = listingsBatchRequestSchema.parse({
      rows: [{ ...row, params: { ...row.params, status: ['Active', 'Coming Soon'] } }],
    });
    expect(parsed.rows[0]?.widen).toBe(false);
  });

  it('rejects an empty batch and a batch over the limit', () => {
    expect(listingsBatchRequestSchema.safeParse({ rows: [] }).success).toBe(false);
    const many = Array.from({ length: LISTINGS_BATCH_MAX_ROWS + 1 }, (_, i) => ({
      ...row,
      id: `r${i}`,
    }));
    expect(listingsBatchRequestSchema.safeParse({ rows: many }).success).toBe(false);
  });

  it('rejects an unknown key and a bad row id', () => {
    expect(listingsBatchRequestSchema.safeParse({ rows: [row], extra: 1 }).success).toBe(false);
    expect(
      listingsBatchRequestSchema.safeParse({ rows: [{ ...row, id: 'bad id!' }] }).success,
    ).toBe(false);
  });
});
