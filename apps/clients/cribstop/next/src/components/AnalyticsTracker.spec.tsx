import { act, render } from '@testing-library/react';
import AnalyticsTracker from './AnalyticsTracker';

let mockPath = '/search';
jest.mock('next/navigation', () => ({ usePathname: () => mockPath }));

const mockTrackEvent = jest.fn();
jest.mock('@/lib/analytics', () => ({
  ...jest.requireActual('@/lib/analytics'),
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}));

const dwellCalls = () => mockTrackEvent.mock.calls.filter(([name]) => name === 'dwell');

describe('AnalyticsTracker (#826)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockTrackEvent.mockReset();
    mockPath = '/search';
  });
  afterEach(() => jest.useRealTimers());

  it('sends page_view with the route template', () => {
    mockPath = '/listing/abc';
    render(<AnalyticsTracker />);
    expect(mockTrackEvent).toHaveBeenCalledWith('page_view', {
      surface: 'detail',
      props: { path_template: '/listing/[id]' },
    });
  });

  it('counts only active visible seconds in dwell', () => {
    const { unmount } = render(<AnalyticsTracker />);
    act(() => void jest.advanceTimersByTime(5000));
    unmount();
    expect(dwellCalls()).toHaveLength(1);
    expect(dwellCalls()[0][1].props).toEqual({ path_template: '/search', active_ms: 5000 });
  });

  it('stops counting after 30 seconds with no input and sends no empty dwell', () => {
    const { unmount } = render(<AnalyticsTracker />);
    act(() => void jest.advanceTimersByTime(90_000));
    unmount();
    expect(dwellCalls()[0][1].props.active_ms).toBe(30_000);
    mockTrackEvent.mockReset();
    const second = render(<AnalyticsTracker />);
    second.unmount();
    expect(dwellCalls()).toHaveLength(0);
  });

  it('does not count a hidden tab', () => {
    const { unmount } = render(<AnalyticsTracker />);
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    act(() => void jest.advanceTimersByTime(10_000));
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    unmount();
    expect(dwellCalls()).toHaveLength(0);
  });

  it('sends dwell with the old route values when the route changes', () => {
    const { rerender } = render(<AnalyticsTracker />);
    act(() => void jest.advanceTimersByTime(3000));
    mockPath = '/favorites';
    rerender(<AnalyticsTracker />);
    expect(dwellCalls()[0][1]).toEqual({
      surface: 'search',
      props: { path_template: '/search', active_ms: 3000 },
    });
    expect(mockTrackEvent).toHaveBeenCalledWith('page_view', {
      surface: 'favorites',
      props: { path_template: '/favorites' },
    });
  });
});
