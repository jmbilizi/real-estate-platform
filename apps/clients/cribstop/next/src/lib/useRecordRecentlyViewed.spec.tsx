import { renderHook } from '@testing-library/react';
import { recordRecentlyViewed } from '@/lib/api/recently-viewed';
import { useApp } from '@/lib/context';
import { useRecordRecentlyViewed } from './useRecordRecentlyViewed';

jest.mock('@/lib/context', () => ({ useApp: jest.fn() }));
jest.mock('@/lib/api/recently-viewed', () => ({ recordRecentlyViewed: jest.fn() }));

const mockUseApp = useApp as jest.Mock;
const mockRecord = recordRecentlyViewed as jest.Mock;

beforeEach(() => {
  mockRecord.mockReset();
  mockUseApp.mockReset();
});

describe('useRecordRecentlyViewed', () => {
  it('sends one record for a signed-in visitor', () => {
    mockUseApp.mockReturnValue({ user: { email: 'a@x.test' } });
    const { rerender } = renderHook(({ id }) => useRecordRecentlyViewed(id), {
      initialProps: { id: 'L1' },
    });
    rerender({ id: 'L1' });
    rerender({ id: 'L1' });

    expect(mockRecord).toHaveBeenCalledTimes(1);
    expect(mockRecord).toHaveBeenCalledWith('L1');
  });

  it('sends nothing for a signed-out visitor', () => {
    mockUseApp.mockReturnValue({ user: null });
    renderHook(() => useRecordRecentlyViewed('L1'));

    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('sends the one record when the visitor signs in on the open page', () => {
    mockUseApp.mockReturnValue({ user: null });
    const { rerender } = renderHook(() => useRecordRecentlyViewed('L1'));
    mockUseApp.mockReturnValue({ user: { email: 'a@x.test' } });
    rerender();
    rerender();

    expect(mockRecord).toHaveBeenCalledTimes(1);
  });

  it('sends a record for the next visitor after a sign-out', () => {
    mockUseApp.mockReturnValue({ user: { email: 'a@x.test' } });
    const { rerender } = renderHook(() => useRecordRecentlyViewed('L1'));
    mockUseApp.mockReturnValue({ user: null });
    rerender();
    mockUseApp.mockReturnValue({ user: { email: 'b@x.test' } });
    rerender();

    expect(mockRecord).toHaveBeenCalledTimes(2);
  });

  it('sends a new record for a different listing', () => {
    mockUseApp.mockReturnValue({ user: { email: 'a@x.test' } });
    const { rerender } = renderHook(({ id }) => useRecordRecentlyViewed(id), {
      initialProps: { id: 'L1' },
    });
    rerender({ id: 'L2' });

    expect(mockRecord.mock.calls).toEqual([['L1'], ['L2']]);
  });
});
