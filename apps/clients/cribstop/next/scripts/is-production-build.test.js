const { isProductionBuild } = require('./is-production-build');

describe('isProductionBuild', () => {
  const originalCI = process.env.CI;
  const originalStandalone = process.env.NEXT_BUILD_STANDALONE;

  afterEach(() => {
    process.env.CI = originalCI;
    process.env.NEXT_BUILD_STANDALONE = originalStandalone;
  });

  it('is false with neither signal set (a local nx build / next build)', () => {
    delete process.env.CI;
    delete process.env.NEXT_BUILD_STANDALONE;

    expect(isProductionBuild()).toBe(false);
  });

  it('is true when CI is set (every GitHub Actions runner)', () => {
    process.env.CI = 'true';
    delete process.env.NEXT_BUILD_STANDALONE;

    expect(isProductionBuild()).toBe(true);
  });

  it('is true when NEXT_BUILD_STANDALONE is set (the Docker build)', () => {
    delete process.env.CI;
    process.env.NEXT_BUILD_STANDALONE = '1';

    expect(isProductionBuild()).toBe(true);
  });
});
