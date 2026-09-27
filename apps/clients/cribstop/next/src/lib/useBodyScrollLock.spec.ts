import { renderHook } from '@testing-library/react';
import { useBodyScrollLock } from './useBodyScrollLock';

/** Regression guard for #360: an open typeahead/panel must lock page scroll, restore the
 *  exact scroll position on close, and not leave the page shifted by the vanished scrollbar. */
describe('useBodyScrollLock', () => {
  beforeEach(() => {
    // jsdom does not implement real scrolling; every test unlocks (explicitly or via
    // testing-library's auto-unmount), which calls this to restore the scroll position.
    window.scrollTo = jest.fn();
  });

  afterEach(() => {
    document.body.style.cssText = '';
  });

  it('pins the body in place and compensates the scrollbar width while locked', () => {
    Object.defineProperty(window, 'scrollY', { value: 240, writable: true, configurable: true });
    Object.defineProperty(window, 'innerWidth', {
      value: 1024,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(document.documentElement, 'clientWidth', {
      value: 1009,
      writable: true,
      configurable: true,
    });

    renderHook(({ locked }) => useBodyScrollLock(locked), { initialProps: { locked: true } });

    expect(document.body.style.position).toBe('fixed');
    expect(document.body.style.top).toBe('-240px');
    expect(document.body.style.paddingRight).toBe('15px');
  });

  it('restores the body and the scroll position once unlocked', () => {
    Object.defineProperty(window, 'scrollY', { value: 500, writable: true, configurable: true });
    const scrollTo = jest.fn();
    window.scrollTo = scrollTo;

    const { rerender } = renderHook(({ locked }) => useBodyScrollLock(locked), {
      initialProps: { locked: true },
    });
    expect(document.body.style.position).toBe('fixed');

    rerender({ locked: false });

    expect(document.body.style.position).toBe('');
    expect(document.body.style.top).toBe('');
    expect(scrollTo).toHaveBeenCalledWith(0, 500);
  });

  it('does nothing while never locked', () => {
    renderHook(({ locked }) => useBodyScrollLock(locked), { initialProps: { locked: false } });

    expect(document.body.style.position).toBe('');
  });

  it('restores on unmount, the same as an explicit unlock', () => {
    Object.defineProperty(window, 'scrollY', { value: 80, writable: true, configurable: true });
    const scrollTo = jest.fn();
    window.scrollTo = scrollTo;

    const { unmount } = renderHook(() => useBodyScrollLock(true));
    expect(document.body.style.position).toBe('fixed');

    unmount();

    expect(document.body.style.position).toBe('');
    expect(scrollTo).toHaveBeenCalledWith(0, 80);
  });
});
