import { QueryClient } from '@tanstack/react-query';
import { savedKeys } from './saved-homes';
import { type SavedTabMessage, startSavedTabSync, type TabChannel } from './saved-tab-sync';

type Listener = (e: { data: unknown }) => void;

/** Channels on one bus, like tabs. A sender does not hear itself. */
function makeBus() {
  const all: FakeChannel[] = [];
  class FakeChannel implements TabChannel {
    listeners = new Set<Listener>();
    constructor() {
      all.push(this);
    }
    postMessage(message: SavedTabMessage) {
      for (const c of all) if (c !== this) c.listeners.forEach((l) => l({ data: message }));
    }
    addEventListener(_t: 'message', l: Listener) {
      this.listeners.add(l);
    }
    removeEventListener(_t: 'message', l: Listener) {
      this.listeners.delete(l);
    }
    close() {}
  }
  return () => new FakeChannel();
}

function makeTab(newChannel: () => TabChannel, marker: string) {
  const client = new QueryClient();
  client.setQueryData(savedKeys.ids, [{ propertyId: 'p1', listingId: null }]);
  const sync = startSavedTabSync({ client, marker, channel: newChannel(), win: null });
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  return { client, sync, invalidate };
}

async function toggle(client: QueryClient, signedIn: boolean) {
  await client
    .getMutationCache()
    .build(client, { mutationKey: savedKeys.all, mutationFn: async () => undefined })
    .execute({ signedIn });
}

describe('saved homes tab sync', () => {
  it('invalidates the saved homes in the other tab after a toggle', async () => {
    const bus = makeBus();
    const a = makeTab(bus, 'm1');
    const b = makeTab(bus, 'm1');
    await toggle(a.client, true);
    expect(b.invalidate).toHaveBeenCalledWith({ queryKey: savedKeys.all });
    expect(a.invalidate).not.toHaveBeenCalled();
  });

  it('copies no data to the other tab', async () => {
    const bus = makeBus();
    const a = makeTab(bus, 'm1');
    const b = makeTab(bus, 'm1');
    a.client.setQueryData(savedKeys.ids, [{ propertyId: 'p2', listingId: 'l2' }]);
    await toggle(a.client, true);
    expect(b.client.getQueryData(savedKeys.ids)).toEqual([{ propertyId: 'p1', listingId: null }]);
  });

  it('does not announce a signed-out toggle', async () => {
    const bus = makeBus();
    const a = makeTab(bus, 'm1');
    const b = makeTab(bus, 'm1');
    await toggle(a.client, false);
    expect(b.invalidate).not.toHaveBeenCalled();
  });

  it("ignores another user's messages", async () => {
    const bus = makeBus();
    const a = makeTab(bus, 'm1');
    const b = makeTab(bus, 'm2');
    await toggle(a.client, true);
    a.sync.announceLogout();
    expect(b.invalidate).not.toHaveBeenCalled();
    expect(b.client.getQueryData(savedKeys.ids)).toHaveLength(1);
  });

  it('empties the saved homes in the other tab on logout', () => {
    const bus = makeBus();
    const a = makeTab(bus, 'm1');
    const b = makeTab(bus, 'm1');
    a.sync.announceLogout();
    expect(b.client.getQueryData(savedKeys.ids)).toEqual([]);
  });

  it('uses a timestamp-only storage event without a channel', async () => {
    const listeners: ((e: Event) => void)[] = [];
    const store: Record<string, string> = {};
    const win = {
      addEventListener: (_t: string, l: (e: Event) => void) => listeners.push(l),
      removeEventListener: jest.fn(),
      localStorage: { setItem: (k: string, v: string) => (store[k] = v) },
    } as unknown as Window;
    const a = new QueryClient();
    const b = new QueryClient();
    startSavedTabSync({ client: a, marker: 'm1', channel: null, win });
    startSavedTabSync({ client: b, marker: 'm1', channel: null, win });
    const invalidate = jest.spyOn(b, 'invalidateQueries');
    await toggle(a, true);
    const [key, value] = Object.entries(store)[0];
    expect(value).toMatch(/^\d+$/);
    listeners.forEach((l) => l({ key } as StorageEvent));
    expect(invalidate).toHaveBeenCalled();
  });

  it('stops listening after stop()', async () => {
    const bus = makeBus();
    const a = makeTab(bus, 'm1');
    const b = makeTab(bus, 'm1');
    b.sync.stop();
    await toggle(a.client, true);
    expect(b.invalidate).not.toHaveBeenCalled();
  });
});
