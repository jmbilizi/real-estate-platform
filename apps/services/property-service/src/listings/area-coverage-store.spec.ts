import type { AreaSyncClient } from './area-coverage-store';
import { listTrackedAreas, recordAreaRefresh } from './area-coverage-store';

function fakeClient(rows: unknown[] = []): {
  client: AreaSyncClient;
  captured: { text: string; values: unknown[] }[];
} {
  const captured: { text: string; values: unknown[] }[] = [];
  const client: AreaSyncClient = {
    query: <T>(text: string, values?: unknown[]) => {
      captured.push({ text, values: values ?? [] });
      return Promise.resolve({ rows: rows as T[] });
    },
  };
  return { client, captured };
}

/** What the scheduled refresh (#331) reads to decide which areas are due. */
describe('listTrackedAreas', () => {
  it('reads only complete, synced rows for the given feed tier', async () => {
    const { client, captured } = fakeClient();

    await listTrackedAreas(client, 'production');

    const [query] = captured;
    expect(query?.text).toContain("status = 'complete'");
    expect(query?.text).toContain('synced_at IS NOT NULL');
    // Sold records are never paged by an area job (#337).
    expect(query?.text).toContain("source_status <> 'Closed'");
    expect(query?.values).toEqual(['production']);
  });

  it('maps rows to the areaKey/sourceStatus/syncedAt shape dueForRefresh needs', async () => {
    const syncedAt = new Date('2026-09-25T00:00:00Z');
    const { client } = fakeClient([
      { area_key: 'frederick||md', source_status: 'Active', synced_at: syncedAt },
    ]);

    const rows = await listTrackedAreas(client, 'production');

    expect(rows).toEqual([{ areaKey: 'frederick||md', sourceStatus: 'Active', syncedAt }]);
  });
});

/** The scheduled refresh's narrow success write (#331) — never the full outcome upsert. */
describe('recordAreaRefresh', () => {
  it('updates only synced_at/attempted_at, scoped to a complete row', async () => {
    const { client, captured } = fakeClient();
    const syncedAt = new Date('2026-09-26T12:00:00Z');

    await recordAreaRefresh(client, 'frederick||md', 'production', 'Active', syncedAt);

    const [query] = captured;
    expect(query?.text).toContain('UPDATE bright_area_sync SET synced_at = $4, attempted_at = $4');
    expect(query?.text).toContain("status = 'complete'");
    expect(query?.text).not.toContain('loaded_count');
    expect(query?.text).not.toContain('resume_key');
    expect(query?.values).toEqual(['frederick||md', 'production', 'Active', syncedAt]);
  });
});
