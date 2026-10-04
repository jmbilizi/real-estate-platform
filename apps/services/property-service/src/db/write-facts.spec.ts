import { Queryable, replaceListingFacts } from './write';

function recordingClient(): { client: Queryable; queries: { text: string; values?: unknown[] }[] } {
  const queries: { text: string; values?: unknown[] }[] = [];
  const client: Queryable = {
    query: (text, values) => {
      queries.push({ text, values });
      return Promise.resolve({ rows: [] });
    },
  };
  return { client, queries };
}

describe('replaceListingFacts (#564)', () => {
  it('deletes the old facts, then inserts every group in feed order', async () => {
    const { client, queries } = recordingClient();

    await replaceListingFacts(client, 'listing-1', {
      heating: ['Forced Air', 'Heat Pump'],
      cooling: [],
      parking: ['Driveway'],
    });

    expect(queries).toHaveLength(2);
    expect(queries[0]?.text).toContain('DELETE FROM listing_facts');
    expect(queries[1]?.values).toEqual([
      'listing-1',
      ['heating', 'heating', 'parking'],
      [0, 1, 0],
      ['Forced Air', 'Heat Pump', 'Driveway'],
    ]);
  });

  it('only deletes when the record carries no facts', async () => {
    const { client, queries } = recordingClient();

    await replaceListingFacts(client, 'listing-1', { heating: [] });

    expect(queries).toHaveLength(1);
  });
});
