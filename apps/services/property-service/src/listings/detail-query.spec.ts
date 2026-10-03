import { LISTING_CARD_SELECT } from './columns';
import { findListingById, type ReadClient } from './repository';

function fakeClient(rows: unknown[]): { client: ReadClient; texts: string[] } {
  const texts: string[] = [];
  const client: ReadClient = {
    query: <T>(text: string) => {
      texts.push(text);
      return Promise.resolve({ rows: rows as T[] });
    },
  };
  return { client, texts };
}

const DETAIL_ONLY = ['listing_facts', 'tax_annual_amount', 'hoa_fee', 'virtual_tour_url'];

describe('detail-only facts in the SQL (#564)', () => {
  it('reads the new facts in the detail query, joined to the visible view row', async () => {
    const { client, texts } = fakeClient([]);

    await findListingById(client, '018f2f2a-6d1b-7c3d-8b2e-000000000001');

    const sql = texts[0] ?? '';
    for (const token of DETAIL_ONLY) {
      expect(sql).toContain(token);
    }
    expect(sql).toContain('FROM listing_search_v v');
    expect(sql).toContain('JOIN listings l ON l.id = v.id');
    expect(sql).toContain("'caption', m.caption");
  });

  it('keeps them out of the card projection', () => {
    for (const token of DETAIL_ONLY) {
      expect(LISTING_CARD_SELECT).not.toContain(token);
    }
  });
});
