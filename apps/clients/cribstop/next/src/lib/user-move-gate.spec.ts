import { createUserMoveGate, shouldSwitchToMapView } from './user-move-gate';

/** The gate tells a user's map move from the app's own, and reports the final view once (#558). */
describe('createUserMoveGate', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const setup = () => {
    const onSettle = jest.fn();
    const gate = createUserMoveGate<string>({
      onSettle,
      debounceMs: 400,
      intentWindowMs: 1500,
      now: () => Date.now(),
    });
    return { gate, onSettle };
  };

  it('ignores a move that no user input started, such as the fit to the place', () => {
    const { gate, onSettle } = setup();

    gate.moveEnd(() => 'fit');
    jest.advanceTimersByTime(5000);

    expect(onSettle).not.toHaveBeenCalled();
  });

  it('reports a move that follows a user input, after the debounce', () => {
    const { gate, onSettle } = setup();

    gate.markIntent();
    gate.moveEnd(() => 'view');
    jest.advanceTimersByTime(399);
    expect(onSettle).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);

    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(onSettle).toHaveBeenCalledWith('view');
  });

  it('reports only the last view of a run of moves', () => {
    const { gate, onSettle } = setup();

    gate.markIntent();
    gate.moveEnd(() => 'a');
    jest.advanceTimersByTime(300);
    gate.markIntent();
    gate.moveEnd(() => 'b');
    jest.advanceTimersByTime(300);
    gate.markIntent();
    gate.moveEnd(() => 'c');
    jest.advanceTimersByTime(400);

    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(onSettle).toHaveBeenCalledWith('c');
  });

  it('ignores a move that ends long after the last input', () => {
    const { gate, onSettle } = setup();

    gate.markIntent();
    jest.advanceTimersByTime(1501);
    gate.moveEnd(() => 'late');
    jest.advanceTimersByTime(5000);

    expect(onSettle).not.toHaveBeenCalled();
  });

  it('reports nothing after dispose', () => {
    const { gate, onSettle } = setup();

    gate.markIntent();
    gate.moveEnd(() => 'view');
    gate.dispose();
    jest.advanceTimersByTime(5000);

    expect(onSettle).not.toHaveBeenCalled();
  });
});

/** A move switches the viewport filter only on a real change of view (#746). */
describe('shouldSwitchToMapView', () => {
  const bounds = { west: -77.1, south: 38.8, east: -77.0, north: 38.9 };
  const inside: [number, number] = [38.85, -77.05];
  const outside: [number, number] = [38.95, -77.05];
  const input = (over: Partial<Parameters<typeof shouldSwitchToMapView>[0]> = {}) => ({
    committedZoom: 12,
    zoom: 12,
    bounds,
    points: [inside],
    ...over,
  });

  it('does not switch on a pan that keeps every result in view', () => {
    expect(shouldSwitchToMapView(input())).toBe(false);
  });

  it('switches on a pan that leaves a result outside the view', () => {
    expect(shouldSwitchToMapView(input({ points: [inside, outside] }))).toBe(true);
  });

  it('never switches on a pan when there are no results', () => {
    expect(shouldSwitchToMapView(input({ points: [] }))).toBe(false);
  });

  it('switches on a zoom change of 0.5 or more, in or out', () => {
    expect(shouldSwitchToMapView(input({ zoom: 12.5 }))).toBe(true);
    expect(shouldSwitchToMapView(input({ zoom: 11 }))).toBe(true);
  });

  it('does not switch on a zoom change below 0.5 with every result in view', () => {
    expect(shouldSwitchToMapView(input({ zoom: 12.49 }))).toBe(false);
  });

  it('switches on a zoom of 0.5 even with no results', () => {
    expect(shouldSwitchToMapView(input({ zoom: 13, points: [] }))).toBe(true);
  });
});

describe('createUserMoveGate reset and moveEnd result', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('says whether a move came from the user', () => {
    const gate = createUserMoveGate<string>({ onSettle: jest.fn(), now: () => Date.now() });
    expect(gate.moveEnd(() => 'fit')).toBe(false);
    gate.markIntent();
    expect(gate.moveEnd(() => 'pan')).toBe(true);
  });

  it('drops the intent and the pending report on reset, as a popup auto-pan needs', () => {
    const onSettle = jest.fn();
    const gate = createUserMoveGate<string>({ onSettle, now: () => Date.now() });

    gate.markIntent();
    gate.moveEnd(() => 'view');
    gate.reset();
    jest.advanceTimersByTime(5000);
    expect(gate.moveEnd(() => 'auto-pan')).toBe(false);

    expect(onSettle).not.toHaveBeenCalled();
  });
});
