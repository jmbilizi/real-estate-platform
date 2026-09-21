import {
  BRIGHT_ENV_VARS,
  BrightConfigError,
  resolveBrightConfig,
  SECRET_PLACEHOLDER,
} from './config';

/**
 * The environment a fully provisioned run sees. Built per test so a mutation cannot leak sideways.
 * The secret value is a fixture, not a credential — it exists so the redaction assertions in
 * `run.spec.ts` have something recognisable to look for.
 */
function configuredEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    [BRIGHT_ENV_VARS.tokenEndpoint]: 'https://bright-staging.example.test/oauth/token',
    [BRIGHT_ENV_VARS.serviceRoot]: 'https://api-staging.example.test/reso/odata',
    [BRIGHT_ENV_VARS.clientId]: 'fixture-client-id',
    [BRIGHT_ENV_VARS.clientSecret]: 'fixture-client-secret',
    ...overrides,
  };
}

describe('resolveBrightConfig', () => {
  it('reports every missing variable when the environment is empty', () => {
    const config = resolveBrightConfig({});

    expect(config.state).toBe('not-configured');
    if (config.state !== 'not-configured') throw new Error('unreachable');
    expect(config.endpoint).toBeNull();
    expect(config.missing).toEqual([
      BRIGHT_ENV_VARS.tokenEndpoint,
      BRIGHT_ENV_VARS.serviceRoot,
      BRIGHT_ENV_VARS.clientId,
      BRIGHT_ENV_VARS.clientSecret,
    ]);
  });

  /**
   * The single most important behaviour in this module. `infra/k8s/base/secrets/bright-mls.secret.yaml`
   * ships this literal, and an unwired environment holds it. Treating it as a real credential
   * would send a guaranteed-bad secret to Bright on every scheduled run and turn a known state into
   * a 401 somebody has to investigate.
   */
  it('treats the committed Git placeholder as absent, not as a credential', () => {
    const config = resolveBrightConfig(
      configuredEnv({
        [BRIGHT_ENV_VARS.clientId]: SECRET_PLACEHOLDER,
        [BRIGHT_ENV_VARS.clientSecret]: SECRET_PLACEHOLDER,
      }),
    );

    expect(config.state).toBe('not-configured');
    if (config.state !== 'not-configured') throw new Error('unreachable');
    expect(config.missing).toEqual([BRIGHT_ENV_VARS.clientId, BRIGHT_ENV_VARS.clientSecret]);
    // The endpoint is configuration, not a credential, so it is still reported — that is what lets
    // a not-configured run still log which feed it would have talked to.
    expect(config.endpoint?.serviceRootHost).toBe('api-staging.example.test');
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

  /**
   * Half a pair means somebody edited one overlay and not the other. Folding it into
   * "not configured" would report a typo as "no credentials yet" and leave it unnoticed for as long
   * as it takes someone to wonder why the feed never arrived.
   */
  it('refuses a half-configured endpoint pair rather than reporting it as absent', () => {
    expect(() =>
      resolveBrightConfig({
        [BRIGHT_ENV_VARS.serviceRoot]: 'https://api-staging.example.test/reso/odata',
      }),
    ).toThrow(BrightConfigError);

    expect(() =>
      resolveBrightConfig({
        [BRIGHT_ENV_VARS.tokenEndpoint]: 'https://bright-staging.example.test/oauth/token',
      }),
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

  /** Ticket #246 failure-mode table, each row asserted directly. */
  describe('BRIGHT_MLS_ENV selector (#246)', () => {
    function productionEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
      return {
        [BRIGHT_ENV_VARS.tokenEndpoint]: 'https://okta.brightmls.com/oauth2/default/v1/token',
        [BRIGHT_ENV_VARS.serviceRoot]: 'https://bright-reso.brightmls.com/RESO/OData/bright',
        [BRIGHT_ENV_VARS.env]: 'production',
        [BRIGHT_ENV_VARS.prodClientId]: 'fixture-prod-id',
        [BRIGHT_ENV_VARS.prodClientSecret]: 'fixture-prod-secret',
        ...overrides,
      };
    }

    it('BRIGHT_MLS_ENV unset resolves to test, never production', () => {
      const config = resolveBrightConfig(configuredEnv());

      expect(config.state).toBe('configured');
      if (config.state !== 'configured') throw new Error('unreachable');
      expect(config.feed).toBe('test');
    });

    it('BRIGHT_MLS_ENV unrecognised throws, the run fails', () => {
      expect(() =>
        resolveBrightConfig(configuredEnv({ [BRIGHT_ENV_VARS.env]: 'staging' })),
      ).toThrow(BrightConfigError);
    });

    it('BRIGHT_MLS_ENV and BRIGHT_MLS_FEED set and disagreeing throws a named error', () => {
      expect(() =>
        resolveBrightConfig(
          configuredEnv({
            [BRIGHT_ENV_VARS.env]: 'test',
            [BRIGHT_ENV_VARS.feed]: 'production',
          }),
        ),
      ).toThrow(BrightConfigError);
    });

    it('BRIGHT_MLS_ENV and BRIGHT_MLS_FEED set and agreeing resolves normally', () => {
      const config = resolveBrightConfig(
        configuredEnv({ [BRIGHT_ENV_VARS.env]: 'test', [BRIGHT_ENV_VARS.feed]: 'test' }),
      );

      expect(config.state).toBe('configured');
      if (config.state !== 'configured') throw new Error('unreachable');
      expect(config.feed).toBe('test');
    });

    it('BRIGHT_MLS_ENV=production, host carries a test label throws, the run fails', () => {
      expect(() =>
        resolveBrightConfig(
          productionEnv({
            [BRIGHT_ENV_VARS.serviceRoot]:
              'https://bright-reso.tst.brightmls.com/RESO/OData/bright',
          }),
        ),
      ).toThrow(BrightConfigError);
    });

    it('BRIGHT_MLS_ENV=test, host carries no test label throws, the run fails', () => {
      expect(() =>
        resolveBrightConfig(
          configuredEnv({
            [BRIGHT_ENV_VARS.serviceRoot]: 'https://bright-reso.brightmls.com/RESO/OData/bright',
          }),
        ),
      ).toThrow(BrightConfigError);
    });

    it('reads only the TEST pair when the tier is test, never the PROD pair', () => {
      const config = resolveBrightConfig(
        configuredEnv({
          [BRIGHT_ENV_VARS.clientId]: undefined,
          [BRIGHT_ENV_VARS.clientSecret]: undefined,
          [BRIGHT_ENV_VARS.testClientId]: 'fixture-test-id',
          [BRIGHT_ENV_VARS.testClientSecret]: 'fixture-test-secret',
          [BRIGHT_ENV_VARS.prodClientId]: 'fixture-prod-id-should-never-be-read',
          [BRIGHT_ENV_VARS.prodClientSecret]: 'fixture-prod-secret-should-never-be-read',
        }),
      );

      expect(config.state).toBe('configured');
      if (config.state !== 'configured') throw new Error('unreachable');
      expect(config.credentials.clientId).toBe('fixture-test-id');
      expect(config.credentials.clientSecret).toBe('fixture-test-secret');
    });

    it('reads only the PROD pair when the tier is production, never the TEST pair', () => {
      const config = resolveBrightConfig(
        productionEnv({
          [BRIGHT_ENV_VARS.testClientId]: 'fixture-test-id-should-never-be-read',
          [BRIGHT_ENV_VARS.testClientSecret]: 'fixture-test-secret-should-never-be-read',
        }),
      );

      expect(config.state).toBe('configured');
      if (config.state !== 'configured') throw new Error('unreachable');
      expect(config.credentials.clientId).toBe('fixture-prod-id');
      expect(config.credentials.clientSecret).toBe('fixture-prod-secret');
    });

    it('a production credential filed under a test environment is never read', () => {
      // Simulates the #164 misfile: a PROD value sits in a `test` environment's secret. The
      // resolver never reads BRIGHT_MLS_PROD_* while the tier is `test`, so the run falls back to
      // the legacy pair and treats the misfile as absent rather than transmitting it.
      const config = resolveBrightConfig(
        configuredEnv({
          [BRIGHT_ENV_VARS.clientId]: undefined,
          [BRIGHT_ENV_VARS.clientSecret]: undefined,
          [BRIGHT_ENV_VARS.prodClientId]: 'misfiled-prod-id',
          [BRIGHT_ENV_VARS.prodClientSecret]: 'misfiled-prod-secret',
        }),
      );

      expect(config.state).toBe('not-configured');
      if (config.state !== 'not-configured') throw new Error('unreachable');
      expect(config.missing).toEqual([BRIGHT_ENV_VARS.clientId, BRIGHT_ENV_VARS.clientSecret]);
    });

    it('a tier credential key still the placeholder resolves not-configured, exit 0', () => {
      // A placeholder is treated as absent BEFORE the fallback decision, which is what keeps an
      // already-provisioned legacy credential working the moment this ticket adds the (still
      // placeholder) tier-suffixed keys to every secret manifest — see the next test. With the
      // legacy pair ALSO absent, resolution has nothing to fall back to and reports not-configured.
      const config = resolveBrightConfig(
        configuredEnv({
          [BRIGHT_ENV_VARS.clientId]: SECRET_PLACEHOLDER,
          [BRIGHT_ENV_VARS.clientSecret]: SECRET_PLACEHOLDER,
          [BRIGHT_ENV_VARS.testClientId]: SECRET_PLACEHOLDER,
          [BRIGHT_ENV_VARS.testClientSecret]: SECRET_PLACEHOLDER,
        }),
      );

      expect(config.state).toBe('not-configured');
      if (config.state !== 'not-configured') throw new Error('unreachable');
      expect(config.missing).toEqual([BRIGHT_ENV_VARS.clientId, BRIGHT_ENV_VARS.clientSecret]);
    });

    it('falls back to the legacy pair only when the tier-suffixed pair is fully unset', () => {
      const config = resolveBrightConfig(configuredEnv());

      expect(config.state).toBe('configured');
      if (config.state !== 'configured') throw new Error('unreachable');
      expect(config.credentials.clientId).toBe('fixture-client-id');
    });

    it('refuses a half-set tier-suffixed pair rather than falling back to the legacy pair', () => {
      expect(() =>
        resolveBrightConfig(
          configuredEnv({ [BRIGHT_ENV_VARS.testClientId]: 'fixture-test-id-only' }),
        ),
      ).toThrow(BrightConfigError);
    });

    /**
     * `config.ts` carries no notion of "which overlay is this". `BRIGHT_MLS_ENV=production`
     * resolves the same way regardless of which environment variables surround it, subject only
     * to the host check and the credential pair — never rejected by overlay identity.
     */
    it('accepts BRIGHT_MLS_ENV=production with no overlay-name restriction', () => {
      const config = resolveBrightConfig(productionEnv());

      expect(config.state).toBe('configured');
      if (config.state !== 'configured') throw new Error('unreachable');
      expect(config.feed).toBe('production');
      expect(config.credentials.clientId).toBe('fixture-prod-id');
    });
  });
});
