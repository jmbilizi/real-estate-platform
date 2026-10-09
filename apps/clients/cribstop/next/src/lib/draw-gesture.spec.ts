import { createDrawGesture, type LockableMap, lockMapInteraction } from './draw-gesture';

const handler = (enabled: boolean) => {
  const state = { on: enabled };
  return {
    state,
    enabled: () => state.on,
    enable: jest.fn(() => {
      state.on = true;
    }),
    disable: jest.fn(() => {
      state.on = false;
    }),
  };
};

describe('lockMapInteraction', () => {
  it('turns off pan, touch zoom and double-click zoom, and restores them', () => {
    const map = {
      dragging: handler(true),
      touchZoom: handler(true),
      doubleClickZoom: handler(true),
    };
    const restore = lockMapInteraction(map as unknown as LockableMap);

    expect(map.dragging.state.on).toBe(false);
    expect(map.touchZoom.state.on).toBe(false);
    expect(map.doubleClickZoom.state.on).toBe(false);

    restore();
    expect(map.dragging.state.on).toBe(true);
    expect(map.touchZoom.state.on).toBe(true);
    expect(map.doubleClickZoom.state.on).toBe(true);
  });

  it('leaves a handler that was already off, off', () => {
    const map = {
      dragging: handler(true),
      touchZoom: handler(false),
      doubleClickZoom: handler(true),
      scrollWheelZoom: handler(false),
    };
    const restore = lockMapInteraction(map as unknown as LockableMap);
    restore();

    expect(map.touchZoom.enable).not.toHaveBeenCalled();
    expect(map.scrollWheelZoom.enable).not.toHaveBeenCalled();
    expect(map.dragging.state.on).toBe(true);
  });
});

describe('createDrawGesture', () => {
  const setup = () => {
    const finished: (readonly [number, number][])[] = [];
    const changes: number[] = [];
    const gesture = createDrawGesture({
      toLngLat: (x, y) => [x / 1000, y / 1000],
      onChange: (path) => changes.push(path.length),
      onFinish: (path) => finished.push([...path] as [number, number][]),
    });
    return { gesture, finished, changes };
  };

  it('collects points from press to release and reports the path once', () => {
    const { gesture, finished } = setup();
    expect(gesture.down({ pointerId: 1, clientX: 10, clientY: 10 })).toBe(true);
    gesture.move({ pointerId: 1, clientX: 40, clientY: 10 });
    gesture.move({ pointerId: 1, clientX: 40, clientY: 40 });
    gesture.up({ pointerId: 1, clientX: 40, clientY: 40 });

    expect(finished).toEqual([
      [
        [0.01, 0.01],
        [0.04, 0.01],
        [0.04, 0.04],
      ],
    ]);
  });

  it('ignores jitter under three pixels', () => {
    const { gesture, finished } = setup();
    gesture.down({ pointerId: 1, clientX: 10, clientY: 10 });
    gesture.move({ pointerId: 1, clientX: 11, clientY: 11 });
    gesture.move({ pointerId: 1, clientX: 12, clientY: 10 });
    gesture.up({ pointerId: 1, clientX: 12, clientY: 10 });
    expect(finished[0]).toHaveLength(1);
  });

  it('never starts a second line from a second finger', () => {
    const { gesture, finished } = setup();
    gesture.down({ pointerId: 1, clientX: 10, clientY: 10 });
    expect(gesture.down({ pointerId: 2, clientX: 200, clientY: 200, isPrimary: false })).toBe(
      false,
    );
    gesture.move({ pointerId: 2, clientX: 300, clientY: 300 });
    gesture.up({ pointerId: 2, clientX: 300, clientY: 300 });
    expect(finished).toHaveLength(0);
    gesture.up({ pointerId: 1, clientX: 10, clientY: 10 });
    expect(finished).toHaveLength(1);
  });

  it('applies nothing when the pointer is cancelled', () => {
    const { gesture, finished, changes } = setup();
    gesture.down({ pointerId: 1, clientX: 10, clientY: 10 });
    gesture.move({ pointerId: 1, clientX: 40, clientY: 10 });
    gesture.cancel();
    gesture.up({ pointerId: 1, clientX: 40, clientY: 10 });
    expect(finished).toHaveLength(0);
    expect(changes.at(-1)).toBe(0);
  });
});
