import { act, renderHook, waitFor } from '@testing-library/react';
import { PAGE_SIZE_DEFAULT } from '@cribstop/property-contracts';
import { searchListings } from '@/lib/api/listings';
import type { SearchFilters } from '@/lib/types';
import { useListingSearch } from './useListingSearch';

/**
 * What this suite exists to stop.
 *
 * The hook only learned a page when a request *resolved*, and every other transition spread the
 * previous state — so `page` reported the last page that succeeded rather than the one being
 * searched for. A paging UI reading it highlighted the wrong page for the whole in-flight window of
 * every new search, and permanently after a failed one, because nothing ever wrote the page again.
 *
 * The cases below are therefore about *when* `page` is read, not about rendering: they hold a
 * request open on a deferred promise so the loading window is a state the test can assert inside,
 * which is the only place the bug was visible.
 */

jest.mock('@/lib/api/listings', () => ({
  searchListings: jest.fn(),
  getListingsMeta: jest.fn(),
  ListingsApiError: class extends Error {},
}));

// Errors surface through the redux-backed toast; these tests assert on the hook, not the toast.
jest.mock('@/lib/useToast', () => ({ useToast: () => ({ toast: jest.fn() }) }));

const mockedSearchListings = searchListings as jest.Mock;

const envelope = (page: number) => ({
  results: [],
  total: 0,
  page,
  pageSize: PAGE_SIZE_DEFAULT,
  pageCount: 5,
  appliedFilters: {},
});

/** A promise the test resolves or rejects itself, so the in-flight window has a defined length. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const FILTERS: SearchFilters = { query: 'Bethesda, MD' };

const renderSearch = (page = 1) =>
  renderHook(({ page: p }) => useListingSearch(FILTERS, p), { initialProps: { page } });

beforeEach(() => {
  mockedSearchListings.mockResolvedValue(envelope(1));
});

afterEach(() => {
  mockedSearchListings.mockReset();
});

describe('useListingSearch reports the page it is searching for', () => {
  it('reports the requested page for the whole in-flight window, not the last one that resolved', async () => {
    const { result, rerender } = renderSearch(1);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.page).toBe(1);

    // Hold page 3 open: this is the window in which `page` used to still say 1.
    const pending = deferred<ReturnType<typeof envelope>>();
    mockedSearchListings.mockReturnValueOnce(pending.promise);

    rerender({ page: 3 });

    await waitFor(() => expect(result.current.status).toBe('loading'));
    expect(result.current.page).toBe(3);

    await act(async () => {
      pending.resolve(envelope(3));
    });

    expect(result.current.status).toBe('ready');
    expect(result.current.page).toBe(3);
  });

  it('keeps reporting the requested page after the request fails, instead of freezing on the old one', async () => {
    const { result, rerender } = renderSearch(1);
    await waitFor(() => expect(result.current.status).toBe('ready'));

    const failing = deferred<ReturnType<typeof envelope>>();
    mockedSearchListings.mockReturnValueOnce(failing.promise);

    rerender({ page: 4 });

    await act(async () => {
      failing.reject(new Error('boom'));
    });

    await waitFor(() => expect(result.current.status).toBe('error'));
    // The stale value persisted forever here: nothing writes the page again after a failure.
    expect(result.current.page).toBe(4);

    // And it survives the re-render a retry button's click would cause.
    rerender({ page: 4 });
    expect(result.current.page).toBe(4);
  });

  it('lets the server-echoed page win once the response arrives, so a clamped page is honoured', async () => {
    // Page 99 is past the end; the service answers with the last real page.
    mockedSearchListings.mockResolvedValue(envelope(5));

    const { result } = renderSearch(99);

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.page).toBe(5);
  });

  it('drops a clamped echo as soon as a different page is requested', async () => {
    mockedSearchListings.mockResolvedValue(envelope(5));
    const { result, rerender } = renderSearch(99);
    await waitFor(() => expect(result.current.page).toBe(5));

    const pending = deferred<ReturnType<typeof envelope>>();
    mockedSearchListings.mockReturnValueOnce(pending.promise);

    rerender({ page: 2 });

    await waitFor(() => expect(result.current.status).toBe('loading'));
    expect(result.current.page).toBe(2);

    await act(async () => {
      pending.resolve(envelope(2));
    });
  });

  it('holds a disabled search on the page it will ask for, not on a previous one', async () => {
    const { result, rerender } = renderHook(
      ({ page, enabled }) => useListingSearch(FILTERS, page, enabled),
      { initialProps: { page: 1, enabled: true } },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(mockedSearchListings).toHaveBeenCalledTimes(1);

    rerender({ page: 6, enabled: false });

    // A held search issues no request at all, so nothing will ever write a page for it — the
    // reported page has to come from the argument or it stays on the previous one indefinitely.
    expect(mockedSearchListings).toHaveBeenCalledTimes(1);
    expect(result.current.page).toBe(6);
  });

  it('asks for the contract’s page size, so the client and the service cannot disagree', async () => {
    const { result } = renderSearch(2);
    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(mockedSearchListings).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, pageSize: PAGE_SIZE_DEFAULT }),
      expect.anything(),
    );
  });
});
