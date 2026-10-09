import { deferUnlockScroll, lockScroll, unlockScroll } from './rootScrollLock';

describe('rootScrollLock (#758)', () => {
  const root = document.documentElement;

  afterEach(() => {
    unlockScroll();
    jest.useRealTimers();
  });

  it('locks the root and restores its styles on unlock', () => {
    lockScroll();
    expect(root.style.overflow).toBe('hidden');
    unlockScroll();
    expect(root.style.overflow).toBe('');
    expect(root.style.scrollbarGutter).toBe('');
    expect(root.style.paddingRight).toBe('');
  });

  it('never sets overflow on the body', () => {
    lockScroll();
    expect(document.body.style.overflow).toBe('');
  });

  it('unlocks on the next macrotask, and a re-lock cancels it', () => {
    jest.useFakeTimers();
    lockScroll();
    deferUnlockScroll();
    lockScroll();
    jest.runAllTimers();
    expect(root.style.overflow).toBe('hidden');
    deferUnlockScroll();
    jest.runAllTimers();
    expect(root.style.overflow).toBe('');
  });
});
