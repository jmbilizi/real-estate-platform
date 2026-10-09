import { createSingleFlight } from './single-flight';

describe('createSingleFlight (#755)', () => {
  it('runs one query for callers that ask for the same key while it runs', async () => {
    const shared = createSingleFlight();
    let release: (value: string) => void = () => undefined;
    const run = jest.fn(() => new Promise<string>((resolve) => (release = resolve)));

    const first = shared('k', run);
    const second = shared('k', run);
    release('rows');

    await expect(Promise.all([first, second])).resolves.toEqual(['rows', 'rows']);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('keeps no result: a call after the query ends runs again', async () => {
    const shared = createSingleFlight();
    const run = jest.fn(() => Promise.resolve('rows'));

    await shared('k', run);
    await shared('k', run);

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('runs different keys separately', async () => {
    const shared = createSingleFlight();
    const run = jest.fn(() => Promise.resolve('rows'));

    await Promise.all([shared('a', run), shared('b', run)]);

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('sends a failure to every waiting caller, then retries on the next call', async () => {
    const shared = createSingleFlight();
    let fail: (error: Error) => void = () => undefined;
    const failing = jest.fn(() => new Promise<string>((_resolve, reject) => (fail = reject)));

    const first = shared('k', failing);
    const second = shared('k', failing);
    fail(new Error('statement timeout'));

    await expect(first).rejects.toThrow('statement timeout');
    await expect(second).rejects.toThrow('statement timeout');
    await expect(shared('k', () => Promise.resolve('ok'))).resolves.toBe('ok');
  });
});
