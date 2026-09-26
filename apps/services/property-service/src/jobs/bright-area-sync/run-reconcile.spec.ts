import type { Area } from '../../listings/on-demand';
import type { TrackedArea } from '../../listings/area-coverage-store';
import type { LocalBrightListing } from './reconcile';
import { type ReconcileDeps, runAreaReconcile } from './run-reconcile';

function baseDeps(overrides: Partial<ReconcileDeps> = {}): ReconcileDeps {
  return {
    listTracked: () => Promise.resolve([]),
    parseArea: (key: string): Area => ({ city: key }),
    fetchLiveKeys: () => Promise.resolve({ listingKeys: [], complete: true }),
    wireToLocalCode: (wireStatus: string) => wireStatus,
    listLocal: () => Promise.resolve([]),
    softDelete: () => Promise.resolve(0),
    log: () => undefined,
    now: () => Date.now(),
    ...overrides,
  };
}

describe('runAreaReconcile', () => {
  it('soft-deletes a local listing absent from Bright live keys across every tracked status', async () => {
    const tracked: TrackedArea[] = [
      { areaKey: 'frederick', sourceStatus: 'Active', syncedAt: new Date() },
      { areaKey: 'frederick', sourceStatus: 'Pending', syncedAt: new Date() },
    ];
    const local: LocalBrightListing[] = [
      { id: 'l1', sourceListingKey: '111' }, // still live under Active
      { id: 'l2', sourceListingKey: '222' }, // absent from every tracked status: gone
    ];
    const softDelete = jest.fn(() => Promise.resolve(1));

    const report = await runAreaReconcile(
      baseDeps({
        listTracked: () => Promise.resolve(tracked),
        fetchLiveKeys: ({ sourceStatus }) =>
          Promise.resolve({
            listingKeys: sourceStatus === 'Active' ? ['111'] : [],
            complete: true,
          }),
        listLocal: () => Promise.resolve(local),
        softDelete,
      }),
    );

    expect(softDelete).toHaveBeenCalledWith(['l2'], expect.stringContaining('frederick'));
    expect(report).toEqual({ areasChecked: 1, areasSkippedIncomplete: 0, listingsSoftDeleted: 1 });
  });

  it('never soft-deletes a listing whose key is live under a DIFFERENT tracked status', async () => {
    const tracked: TrackedArea[] = [
      { areaKey: 'frederick', sourceStatus: 'Active', syncedAt: new Date() },
      { areaKey: 'frederick', sourceStatus: 'Pending', syncedAt: new Date() },
    ];
    // Locally still recorded Active, but Bright now reports it live under Pending: a status
    // change, not a delete.
    const local: LocalBrightListing[] = [{ id: 'l1', sourceListingKey: '111' }];
    const softDelete = jest.fn(() => Promise.resolve(0));

    const report = await runAreaReconcile(
      baseDeps({
        listTracked: () => Promise.resolve(tracked),
        fetchLiveKeys: ({ sourceStatus }) =>
          Promise.resolve({
            listingKeys: sourceStatus === 'Pending' ? ['111'] : [],
            complete: true,
          }),
        listLocal: () => Promise.resolve(local),
        softDelete,
      }),
    );

    expect(softDelete).not.toHaveBeenCalled();
    expect(report.listingsSoftDeleted).toBe(0);
  });

  it('skips an area, without deleting anything, when a status read was capped', async () => {
    const tracked: TrackedArea[] = [
      { areaKey: 'frederick', sourceStatus: 'Active', syncedAt: new Date() },
    ];
    const softDelete = jest.fn(() => Promise.resolve(0));

    const report = await runAreaReconcile(
      baseDeps({
        listTracked: () => Promise.resolve(tracked),
        fetchLiveKeys: () => Promise.resolve({ listingKeys: [], complete: false }),
        listLocal: () => Promise.resolve([{ id: 'l1', sourceListingKey: '111' }]),
        softDelete,
      }),
    );

    expect(softDelete).not.toHaveBeenCalled();
    expect(report).toEqual({ areasChecked: 0, areasSkippedIncomplete: 1, listingsSoftDeleted: 0 });
  });

  it('does nothing when no area is tracked', async () => {
    const report = await runAreaReconcile(baseDeps());
    expect(report).toEqual({ areasChecked: 0, areasSkippedIncomplete: 0, listingsSoftDeleted: 0 });
  });
});
