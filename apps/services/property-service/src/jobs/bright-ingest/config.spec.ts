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
   * ships this literal, and `local`/`test` will hold it forever. Treating it as a real credential
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
});
