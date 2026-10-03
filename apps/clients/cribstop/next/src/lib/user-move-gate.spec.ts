import { createUserMoveGate } from './user-move-gate';

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
