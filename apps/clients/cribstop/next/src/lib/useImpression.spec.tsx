import { act, render } from '@testing-library/react';
import { installFakeIntersectionObserver, setVisibleRatio } from '@/test/intersection';
import { resetImpressions, useImpression } from './useImpression';

function Card({ id, onImpression }: { id: string; onImpression: () => void }) {
  const ref = useImpression<HTMLDivElement>(id, onImpression);
  return <div ref={ref}>card</div>;
}

describe('useImpression', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    installFakeIntersectionObserver();
    resetImpressions();
  });
  afterEach(() => jest.useRealTimers());

  it('fires once after 1 second at 50% visible', () => {
    const on = jest.fn();
    render(<Card id="a" onImpression={on} />);
    act(() => setVisibleRatio(0.5));
    act(() => void jest.advanceTimersByTime(999));
    expect(on).not.toHaveBeenCalled();
    act(() => void jest.advanceTimersByTime(1));
    expect(on).toHaveBeenCalledTimes(1);
  });

  it('does not fire below 50% visible', () => {
    const on = jest.fn();
    render(<Card id="a" onImpression={on} />);
    act(() => setVisibleRatio(0.49));
    act(() => void jest.advanceTimersByTime(5000));
    expect(on).not.toHaveBeenCalled();
  });

  it('does not fire when the card leaves before 1 second', () => {
    const on = jest.fn();
    render(<Card id="a" onImpression={on} />);
    act(() => setVisibleRatio(0.8));
    act(() => void jest.advanceTimersByTime(600));
    act(() => setVisibleRatio(0));
    act(() => void jest.advanceTimersByTime(5000));
    expect(on).not.toHaveBeenCalled();
  });

  it('does not fire in a hidden tab', () => {
    const on = jest.fn();
    render(<Card id="a" onImpression={on} />);
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    act(() => setVisibleRatio(1));
    act(() => void jest.advanceTimersByTime(2000));
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    expect(on).not.toHaveBeenCalled();
  });

  it('counts a re-render and a remount once per page view', () => {
    const on = jest.fn();
    const { rerender, unmount } = render(<Card id="a" onImpression={on} />);
    act(() => setVisibleRatio(1));
    act(() => void jest.advanceTimersByTime(1000));
    rerender(<Card id="a" onImpression={on} />);
    act(() => setVisibleRatio(1));
    act(() => void jest.advanceTimersByTime(2000));
    unmount();
    render(<Card id="a" onImpression={on} />);
    act(() => setVisibleRatio(1));
    act(() => void jest.advanceTimersByTime(2000));
    expect(on).toHaveBeenCalledTimes(1);
  });

  it('counts the card again after a route change', () => {
    const on = jest.fn();
    const { unmount } = render(<Card id="a" onImpression={on} />);
    act(() => setVisibleRatio(1));
    act(() => void jest.advanceTimersByTime(1000));
    unmount();
    resetImpressions();
    render(<Card id="a" onImpression={on} />);
    act(() => setVisibleRatio(1));
    act(() => void jest.advanceTimersByTime(1000));
    expect(on).toHaveBeenCalledTimes(2);
  });
});
