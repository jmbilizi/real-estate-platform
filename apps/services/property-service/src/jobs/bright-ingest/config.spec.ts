import {
  BRIGHT_ENV_VARS,
  BrightConfigError,
  DEFAULT_REPLICATION,
  resolveBrightConfig,
  resolveReplicationConfig,
  SECRET_PLACEHOLDER,
} from './config';

/**
 * The environment a fully provisioned run sees. Built per test so a mutation cannot leak sideways.
 * The secret value is a fixture, not a credential — it exists so the redaction assertions in
 * `run.spec.ts` have something recognisable to look for.
 */
function configuredEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    [BRIGHT_ENV_VARS.env]: 'test',
    [BRIGHT_ENV_VARS.tokenEndpoint]: 'https://bright-staging.example.test/oauth/token',
    [BRIGHT_ENV_VARS.serviceRoot]: 'https://api-staging.example.test/reso/odata',
    [BRIGHT_ENV_VARS.clientId]: 'fixture-client-id',
    [BRIGHT_ENV_VARS.clientSecret]: 'fixture-client-secret',
    ...overrides,
  };
}

describe('resolveBrightConfig', () => {
  it('reports all three keys missing when the environment is empty', () => {
    const config = resolveBrightConfig({});

    expect(config.state).toBe('not-configured');
    if (config.state !== 'not-configured') throw new Error('unreachable');
    expect(config.endpoint).toBeNull();
    expect(config.missing).toEqual([
      BRIGHT_ENV_VARS.env,
      BRIGHT_ENV_VARS.clientId,
      BRIGHT_ENV_VARS.clientSecret,
    ]);
  });

  /**
   * `infra/k8s/base/secrets/bright-mls.secret.yaml` ships this literal, and an unwired environment
   * holds it. Treating it as a real value would send a guaranteed-bad secret to Bright on every run.
   */
  it('treats the committed Git placeholder as absent, for all three keys', () => {
    const config = resolveBrightConfig({
      [BRIGHT_ENV_VARS.env]: SECRET_PLACEHOLDER,
      [BRIGHT_ENV_VARS.clientId]: SECRET_PLACEHOLDER,
      [BRIGHT_ENV_VARS.clientSecret]: SECRET_PLACEHOLDER,
    });

    expect(config.state).toBe('not-configured');
    if (config.state !== 'not-configured') throw new Error('unreachable');
    expect(config.missing).toEqual([
      BRIGHT_ENV_VARS.env,
      BRIGHT_ENV_VARS.clientId,
      BRIGHT_ENV_VARS.clientSecret,
    ]);
  });

  it('still reports the tier endpoint when only the credential is missing', () => {
    const config = resolveBrightConfig({ [BRIGHT_ENV_VARS.env]: 'production' });

    expect(config.state).toBe('not-configured');
    if (config.state !== 'not-configured') throw new Error('unreachable');
    expect(config.endpoint?.serviceRootHost).toBe('bright-reso.brightmls.com');
    expect(config.missing).toEqual([BRIGHT_ENV_VARS.clientId, BRIGHT_ENV_VARS.clientSecret]);
  });

  it('treats blank and whitespace-only values as absent', () => {
    const config = resolveBrightConfig(configuredEnv({ [BRIGHT_ENV_VARS.clientSecret]: '   \t ' }));

    expect(config.state).toBe('not-configured');
    if (config.state !== 'not-configured') throw new Error('unreachable');
    expect(config.missing).toEqual([BRIGHT_ENV_VARS.clientSecret]);
  });

  it('resolves a fully provisioned environment and exposes hosts separately from URLs', () => {
    const config = resolveBrightConfig(configuredEnv());

    expect(config.state).toBe('configured');
    if (config.state !== 'configured') throw new Error('unreachable');
    expect(config.endpoint.tokenEndpointHost).toBe('bright-staging.example.test');
    expect(config.endpoint.serviceRootHost).toBe('api-staging.example.test');
    expect(config.endpoint.tokenEndpoint).toBe('https://bright-staging.example.test/oauth/token');
    expect(config.credentials.clientId).toBe('fixture-client-id');
    expect(config.credentials.clientSecret).toBe('fixture-client-secret');
  });

  it('trims surrounding whitespace, which a copied-in secret value routinely carries', () => {
    const config = resolveBrightConfig(
      configuredEnv({ [BRIGHT_ENV_VARS.clientId]: '  fixture-client-id\n' }),
    );

    expect(config.state).toBe('configured');
    if (config.state !== 'configured') throw new Error('unreachable');
    expect(config.credentials.clientId).toBe('fixture-client-id');
  });

  it('refuses a half-configured endpoint override rather than reporting it as absent', () => {
    expect(() =>
      resolveBrightConfig(configuredEnv({ [BRIGHT_ENV_VARS.tokenEndpoint]: undefined })),
    ).toThrow(BrightConfigError);
    expect(() =>
      resolveBrightConfig(configuredEnv({ [BRIGHT_ENV_VARS.serviceRoot]: undefined })),
    ).toThrow(BrightConfigError);
  });

  it('refuses a malformed endpoint URL', () => {
    expect(() =>
      resolveBrightConfig(configuredEnv({ [BRIGHT_ENV_VARS.serviceRoot]: 'not-a-url' })),
    ).toThrow(BrightConfigError);
  });

  /** The token request carries an OAuth2 client secret; a downgrade is not a warning-level event. */
  it('refuses a plaintext http endpoint', () => {
    expect(() =>
      resolveBrightConfig(
        configuredEnv({ [BRIGHT_ENV_VARS.tokenEndpoint]: 'http://bright.example.test/token' }),
      ),
    ).toThrow(/https/i);
  });

  describe('BRIGHT_MLS_ENV is trusted exactly', () => {
    function tierEnv(tier: string): NodeJS.ProcessEnv {
      return {
        [BRIGHT_ENV_VARS.env]: tier,
        [BRIGHT_ENV_VARS.clientId]: 'fixture-id',
        [BRIGHT_ENV_VARS.clientSecret]: 'fixture-secret',
      };
    }

    it('production reads the production feed endpoints', () => {
      const config = resolveBrightConfig(tierEnv('production'));

      expect(config.state).toBe('configured');
      if (config.state !== 'configured') throw new Error('unreachable');
      expect(config.feed).toBe('production');
      expect(config.endpoint.tokenEndpointHost).toBe('okta.brightmls.com');
      expect(config.endpoint.serviceRootHost).toBe('bright-reso.brightmls.com');
    });

    it('test reads the test feed endpoints', () => {
      const config = resolveBrightConfig(tierEnv('test'));

      expect(config.state).toBe('configured');
      if (config.state !== 'configured') throw new Error('unreachable');
      expect(config.feed).toBe('test');
      expect(config.endpoint.tokenEndpointHost).toBe('okta.tst.brightmls.com');
      expect(config.endpoint.serviceRootHost).toBe('bright-reso.tst.brightmls.com');
    });

    it('is case-insensitive', () => {
      const config = resolveBrightConfig(tierEnv('Production'));

      expect(config.state).toBe('configured');
      if (config.state !== 'configured') throw new Error('unreachable');
      expect(config.feed).toBe('production');
    });

    it('refuses an unrecognised value, and the run fails', () => {
      expect(() => resolveBrightConfig(tierEnv('staging'))).toThrow(BrightConfigError);
    });

    it('refuses an endpoint override on the other tier, in both directions', () => {
      expect(() =>
        resolveBrightConfig({
          ...tierEnv('production'),
          [BRIGHT_ENV_VARS.tokenEndpoint]: 'https://okta.tst.brightmls.com/oauth2/default/v1/token',
          [BRIGHT_ENV_VARS.serviceRoot]: 'https://bright-reso.tst.brightmls.com/RESO/OData/bright',
        }),
      ).toThrow(BrightConfigError);
      expect(() =>
        resolveBrightConfig({
          ...tierEnv('test'),
          [BRIGHT_ENV_VARS.tokenEndpoint]: 'https://okta.brightmls.com/oauth2/default/v1/token',
          [BRIGHT_ENV_VARS.serviceRoot]: 'https://bright-reso.brightmls.com/RESO/OData/bright',
        }),
      ).toThrow(BrightConfigError);
    });
  });
});

/** Ticket #191: the full-crawl path is off by default, and only an environment names it in. */
describe('resolveReplicationConfig — full crawl (#191)', () => {
  it('defaults to no crawl resources and 50 pages per crawl run', () => {
    const config = resolveReplicationConfig({});

    expect(config.crawlResources).toEqual([]);
    expect(config.crawlResources).toEqual(DEFAULT_REPLICATION.crawlResources);
    expect(config.crawlMaxPagesPerRun).toBe(50);
  });

  it('reads a configured crawl resource', () => {
    const config = resolveReplicationConfig({
      [BRIGHT_ENV_VARS.crawlResources]: 'BrightMedia',
    });

    expect(config.crawlResources).toEqual(['BrightMedia']);
  });

  it('refuses an unknown crawl resource name', () => {
    expect(() =>
      resolveReplicationConfig({ [BRIGHT_ENV_VARS.crawlResources]: 'Property' }),
    ).toThrow(BrightConfigError);
  });

  /** BrightProperties has a working cursor; a full crawl of it is the wrong tool, not an option. */
  it('refuses a resource that does not support the full-crawl path', () => {
    expect(() =>
      resolveReplicationConfig({ [BRIGHT_ENV_VARS.crawlResources]: 'BrightProperties' }),
    ).toThrow(BrightConfigError);
  });

  it('reads a configured crawl page cap', () => {
    const config = resolveReplicationConfig({
      [BRIGHT_ENV_VARS.crawlMaxPagesPerRun]: '10',
    });

    expect(config.crawlMaxPagesPerRun).toBe(10);
  });

  it('refuses a malformed crawl page cap', () => {
    expect(() =>
      resolveReplicationConfig({ [BRIGHT_ENV_VARS.crawlMaxPagesPerRun]: 'lots' }),
    ).toThrow(BrightConfigError);
  });
});
