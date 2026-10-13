/** A controllable IntersectionObserver for tests of visibility-based events (#826). */
type Callback = (entries: Partial<IntersectionObserverEntry>[]) => void;

export interface FakeObserver {
  callback: Callback;
  element: Element | null;
  disconnected: boolean;
}

export const observers: FakeObserver[] = [];

export function installFakeIntersectionObserver(): void {
  observers.length = 0;
  class Fake {
    state: FakeObserver;
    constructor(callback: Callback) {
      this.state = { callback, element: null, disconnected: false };
      observers.push(this.state);
    }
    observe(el: Element) {
      this.state.element = el;
    }
    unobserve() {}
    disconnect() {
      this.state.disconnected = true;
    }
  }
  (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = Fake;
}

/** Reports the ratio to every live observer. */
export function setVisibleRatio(ratio: number): void {
  for (const o of observers.filter((x) => !x.disconnected)) {
    o.callback([
      { isIntersecting: ratio > 0, intersectionRatio: ratio, target: o.element as Element },
    ]);
  }
}
