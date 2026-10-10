const {
  diffMigrationHistory,
  formatHistoryMismatch,
  readRecordedNames,
} = require('./migrate-history');

const files = ['001_a', '002_b', '003_c'];

describe('migrate-history', () => {
  it('reports no mismatch for a matching history', () => {
    expect(diffMigrationHistory(['001_a', '002_b', '003_c'], files)).toEqual({
      unexpected: [],
      missing: [],
    });
  });

  it('treats files after the latest recorded one as pending, not missing', () => {
    expect(diffMigrationHistory(['001_a'], files)).toEqual({ unexpected: [], missing: [] });
  });

  it('reports a recorded row that has no file', () => {
    expect(diffMigrationHistory(['001_a', '002_b', '002x_other-branch'], files)).toEqual({
      unexpected: ['002x_other-branch'],
      missing: [],
    });
  });

  it('reports a file that is not recorded although a later one is', () => {
    expect(diffMigrationHistory(['001_a', '003_c'], files)).toEqual({
      unexpected: [],
      missing: ['002_b'],
    });
  });

  it('names the cause, the rows and the recovery command', () => {
    const message = formatHistoryMismatch({ unexpected: ['9_x'], missing: ['2_b'] });
    expect(message).toContain('Another branch');
    expect(message).toContain('9_x');
    expect(message).toContain('2_b');
    expect(message).toContain('pnpm run infra:local:cluster:delete');
  });

  it('reads recorded names in run order', async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [{ name: 'a' }, { name: 'b' }] }) };
    await expect(readRecordedNames(client, 'pgmigrations')).resolves.toEqual(['a', 'b']);
    expect(client.query.mock.calls[0][0]).toContain('ORDER BY run_on, id');
  });
});
