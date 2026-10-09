import { resetWebGL2CacheForTests, supportsWebGL2 } from './webgl2';

function stubContext(impl: () => unknown) {
  return jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(impl as never);
}

afterEach(() => {
  jest.restoreAllMocks();
  resetWebGL2CacheForTests();
});

describe('supportsWebGL2', () => {
  it('is true when the browser returns a webgl2 context', () => {
    const spy = stubContext(() => ({}));
    expect(supportsWebGL2()).toBe(true);
    expect(spy).toHaveBeenCalledWith('webgl2');
  });

  it('is false when getContext returns null', () => {
    stubContext(() => null);
    expect(supportsWebGL2()).toBe(false);
  });

  it('is false when getContext throws', () => {
    stubContext(() => {
      throw new Error('blocked');
    });
    expect(supportsWebGL2()).toBe(false);
  });

  it('tests once and caches the answer', () => {
    const spy = stubContext(() => ({}));
    supportsWebGL2();
    supportsWebGL2();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
