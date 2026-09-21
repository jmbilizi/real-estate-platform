import type { FetchLike } from './bright-client';
import { BRIGHT_ENV_VARS, SECRET_PLACEHOLDER } from './config';
import { createMemoryStore, createMockResoServer } from './mock-reso-server';
import { isOrderedWithoutFilter } from './odata-query';
import { runBrightIngest } from './run';
import type { BrightRunFinishedRecord, BrightRunRecord } from './run-log';

const CLIENT_ID = 'fixture-client-id-3f9a';
const CLIENT_SECRET = 'fixture-client-secret-91b2c7';
const TOKEN_ENDPOINT = 'https://bright-staging.example.test/oauth/token';
const SERVICE_ROOT = 'https://api-staging.example.test/reso/odata/';

function configuredEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    [BRIGHT_ENV_VARS.tokenEndpoint]: TOKEN_ENDPOINT,
    [BRIGHT_ENV_VARS.serviceRoot]: SERVICE_ROOT,
    [BRIGHT_ENV_VARS.clientId]: CLIENT_ID,
    [BRIGHT_ENV_VARS.clientSecret]: CLIENT_SECRET,
    ...overrides,
  };
}

interface StubResponse {
  ok?: boolean;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string;
}

/** Records every request so the assertions can inspect the URL, method and body the job sent. */
function stubFetch(responses: StubResponse[]): {
  fetchImpl: FetchLike;
  calls: { url: string; method: string; body?: string; headers: Record<string, string> }[];
} {
  const calls: { url: string; method: string; body?: string; headers: Record<string, string> }[] =
    [];
  let index = 0;

  const fetchImpl: FetchLike = (url, init) => {
    calls.push({ url, method: init.method, body: init.body, headers: init.headers });
    const spec = responses[index] ?? {};
    index += 1;
    const headers = spec.headers ?? {};
    return Promise.resolve({
      ok: spec.ok ?? true,
      status: spec.status ?? 200,
      statusText: spec.statusText ?? 'OK',
      headers: {
        get: (name: string) =>
          headers[Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase()) ?? ''] ??
          null,
      },
      text: () => Promise.resolve(spec.body ?? ''),
    });
  };

  return { fetchImpl, calls };
}

/** A clock that advances a fixed amount between calls, so `durationMs` is assertable. */
function fixedClock(startIso: string, stepMs: number): () => Date {
  let current = new Date(startIso).getTime();
  return () => {
    const value = new Date(current);
    current += stepMs;
    return value;
  };
}

function collectRecords(): { sink: (record: BrightRunRecord) => void; records: BrightRunRecord[] } {
  const records: BrightRunRecord[] = [];
  return { sink: (record) => records.push(record), records };
}

function listings(count: number, startIso = '2026-09-02T00:00:00.000Z') {
  const start = Date.parse(startIso);
  return Array.from({ length: count }, (_, i) => ({
    ListingKey: 5000 + i,
    ModificationTimestamp: new Date(start + i * 60_000).toISOString(),
  }));
}

/** A whole run against the mock RESO server. CI never holds a Bright credential. */
function mockRun(
  options: {
    env?: NodeJS.ProcessEnv;
    records?: Record<string, readonly Record<string, unknown>[]>;
    pageSize?: number;
    failures?: readonly number[];
    memory?: ReturnType<typeof createMemoryStore>;
    now?: () => Date;
  } = {},
) {
  const server = createMockResoServer({
    tokenEndpoint: TOKEN_ENDPOINT,
    serviceRoot: SERVICE_ROOT,
    records: options.records ?? { BrightProperties: listings(6) },
    pageSize: options.pageSize ?? 4,
    failures: options.failures,
  });
  const memory = options.memory ?? createMemoryStore();
  const { sink, records } = collectRecords();

  const invoke = () =>
    runBrightIngest({
      env: options.env ?? configuredEnv(),
      sink,
      fetchImpl: server.fetchImpl,
      store: memory.store,
      sleep: () => Promise.resolve(),
      random: () => 0,
      now: options.now,
    });

  return { server, memory, records, invoke };
}

describe('runBrightIngest — not configured', () => {
  it('completes successfully, names the missing variables, and reaches Bright not at all', async () => {
    const { sink, records } = collectRecords();
    const { fetchImpl, calls } = stubFetch([]);

    const result = await runBrightIngest({ env: {}, sink, fetchImpl, runId: 'run-1' });

    expect(result.outcome).toBe('not_configured');
    expect(calls).toHaveLength(0);
    expect(result.message).toContain(BRIGHT_ENV_VARS.clientSecret);
    // The pointer to the runbook is the difference between a loud completion and a shrug.
    expect(result.message).toContain('bright-mls-day-one-checklist.md');
    expect(records.map((r) => r.event)).toEqual(['run_started', 'run_finished']);
    expect(records[1]).toMatchObject({ outcome: 'not_configured' });
  });

  /**
   * An environment whose secret is not provisioned holds the committed placeholder. This is the
   * exact shape of a run there, and it must be a clean completion — not a 401, not a failed Job.
   */
  it('treats the committed placeholder as not configured, with the endpoint still reported', async () => {
    const { sink, records } = collectRecords();
    const { fetchImpl, calls } = stubFetch([]);

    const result = await runBrightIngest({
      env: configuredEnv({
        [BRIGHT_ENV_VARS.clientId]: SECRET_PLACEHOLDER,
        [BRIGHT_ENV_VARS.clientSecret]: SECRET_PLACEHOLDER,
      }),
      sink,
      fetchImpl,
    });

    expect(result.outcome).toBe('not_configured');
    expect(calls).toHaveLength(0);
    // Which feed this environment is pointed at is knowable even with no credential.
    expect(result.serviceRootHost).toBe('api-staging.example.test');
    expect(records[0]).toMatchObject({ tokenEndpointHost: 'bright-staging.example.test' });
  });

  it('reports zero counts', async () => {
    const { sink } = collectRecords();
    const result = await runBrightIngest({ env: {}, sink, fetchImpl: stubFetch([]).fetchImpl });

    expect(result.counts.recordsFetched).toBe(0);
    expect(result.counts.recordsStaged).toBe(0);
    expect(result.counts.recordsUpserted).toBe(0);
  });
});

describe('runBrightIngest — replication', () => {
  it('probes $metadata, replicates into staging, and reports the hosts it used', async () => {
    const { records, memory, invoke } = mockRun({
      records: { BrightProperties: listings(6) },
      now: fixedClock('2026-09-15T03:00:00.000Z', 1_250),
    });

    const result = await invoke();

    expect(result.outcome).toBe('replicated');
    expect(result.tokenEndpointHost).toBe('bright-staging.example.test');
    expect(result.counts.recordsFetched).toBe(6);
    expect(result.counts.recordsStaged).toBe(6);
    expect(memory.rows.size).toBe(6);

    const finished = records[1] as BrightRunFinishedRecord;
    expect(finished.outcome).toBe('replicated');
    expect(finished.metadata?.odataVersion).toBe('4.0');
    expect(finished.feed).toBe('test');
    expect(finished.resources?.[0]).toMatchObject({
      resource: 'BrightProperties',
      recordsStaged: 6,
      caughtUp: true,
    });
  });

  /** Mapping into `properties`/`units`/`listings` is #93. This run writes no consumer row. */
  it('reports nothing upserted into the consumer schema', async () => {
    const { invoke } = mockRun();
    await expect(invoke()).resolves.toMatchObject({ counts: { recordsUpserted: 0 } });
  });

  it('sends no unbounded ordered request on any page', async () => {
    const { server, invoke } = mockRun({ records: { BrightProperties: listings(10) } });
    await invoke();

    expect(server.pageRequests.length).toBeGreaterThan(1);
    for (const url of server.pageRequests) {
      expect(isOrderedWithoutFilter(url)).toBe(false);
    }
  });

  /**
   * Measured 2026-09-19 on the BRIGHTIDXTEST account: `BrightMedia` and `Deletion` answer 400 to
   * every `$filter`, including one on their own key, and `Deletion` refuses `$orderby` as well.
   * Configuring either must fail at startup with the evidence, not turn into a nightly failed Job.
   */
  it.each(['BrightMedia', 'Deletion'])(
    'refuses %s, which this feed tier will not filter',
    async (resource) => {
      const { server, invoke } = mockRun({
        env: configuredEnv({ [BRIGHT_ENV_VARS.resources]: resource }),
      });

      const result = await invoke();

      expect(result.outcome).toBe('failed');
      expect(result.message).toContain('cannot be replicated incrementally');
      expect(server.pageRequests).toHaveLength(0);
    },
  );

  it('clears every cursor first when a full resync is requested', async () => {
    const memory = createMemoryStore();
    await mockRun({ records: { BrightProperties: listings(4) }, memory }).invoke();
    expect(memory.cursors.get('BrightProperties')?.modifiedAt).not.toBeNull();

    const resync = mockRun({
      env: configuredEnv({ [BRIGHT_ENV_VARS.fullResync]: '1' }),
      records: { BrightProperties: listings(4) },
      memory,
    });
    const result = await resync.invoke();

    // Everything is read again, and the upsert makes the second pass idempotent.
    expect(result.counts.recordsFetched).toBe(4);
    expect(memory.rows.size).toBe(4);
  });

  /** A full resync obeys the same ceiling. It is the run most likely to break one. */
  it('paces a full resync through the same limiter', async () => {
    const { server, invoke } = mockRun({
      env: configuredEnv({
        [BRIGHT_ENV_VARS.requestsPerSecond]: '1',
        [BRIGHT_ENV_VARS.requestsPerMinute]: '5',
        [BRIGHT_ENV_VARS.fullResync]: '1',
      }),
      records: { BrightProperties: listings(12) },
      pageSize: 3,
    });

    await invoke();
    expect(server.pageRequests.length).toBeGreaterThan(1);
  });

  it('retries a 429 and reports the retry count', async () => {
    const { invoke } = mockRun({ records: { BrightProperties: listings(2) }, failures: [429] });
    await expect(invoke()).resolves.toMatchObject({ counts: { retries: 1, recordsStaged: 2 } });
  });

  /**
   * A stalled cursor is the failure nothing else catches: every run succeeds, every count is
   * plausible, and the data is a month old.
   */
  it('reports a stalled cursor loudly', async () => {
    const { records, invoke } = mockRun({
      env: configuredEnv({ [BRIGHT_ENV_VARS.cursorMaxAgeHours]: '1' }),
      records: { BrightProperties: listings(1, '2026-01-01T00:00:00.000Z') },
      now: () => new Date('2026-09-15T00:00:00.000Z'),
    });

    const result = await invoke();

    expect(result.stalled).toBe(true);
    expect(result.message).toContain('STALLED CURSOR');
    expect((records[1] as BrightRunFinishedRecord).stalled).toBe(true);
  });
});

describe('runBrightIngest — feed tier', () => {
  /**
   * Stakeholder ruling 2026-09-19: `local`, `dev` and `test` read Bright's test feed; `prod` alone
   * reads the licensed production feed. The base default is `test`, so an environment that patches
   * nothing cannot inherit production.
   */
  it('refuses a production host when the environment declares the test tier', async () => {
    const { sink } = collectRecords();
    const result = await runBrightIngest({
      env: configuredEnv({
        [BRIGHT_ENV_VARS.serviceRoot]: 'https://bright-reso.brightmls.com/RESO/OData/bright',
      }),
      sink,
      fetchImpl: stubFetch([]).fetchImpl,
    });

    expect(result.outcome).toBe('failed');
    expect(result.message).toContain('not a recognised test-feed host');
  });

  it('refuses a production token endpoint too, whatever the service root says', async () => {
    const { sink } = collectRecords();
    const result = await runBrightIngest({
      env: configuredEnv({
        [BRIGHT_ENV_VARS.tokenEndpoint]: 'https://okta.brightmls.com/oauth2/default/v1/token',
      }),
      sink,
      fetchImpl: stubFetch([]).fetchImpl,
    });

    expect(result.outcome).toBe('failed');
    expect(result.message).toContain('BRIGHT_MLS_TOKEN_ENDPOINT');
  });

  it('refuses a test-labelled host when the environment declares the production tier (#246)', async () => {
    // Ticket #246: the host check is now two-directional. The shared mock server binds to
    // `TOKEN_ENDPOINT`/`SERVICE_ROOT`, both test-labelled, so declaring `production` here must
    // fail on the same hosts that `test` accepts.
    const { sink } = collectRecords();
    const result = await runBrightIngest({
      env: configuredEnv({ [BRIGHT_ENV_VARS.env]: 'production' }),
      sink,
      fetchImpl: stubFetch([]).fetchImpl,
    });

    expect(result.outcome).toBe('failed');
    expect(result.message).toContain('is a recognised test-feed host');
  });

  /**
   * #246: any environment may declare `production`, subject only to the host and credential
   * checks — `config.ts` carries no overlay-name restriction. Verified against a second mock
   * server whose hosts carry no non-production label, using the PROD credential pair.
   */
  it('allows a production host under the production declaration, with no overlay restriction', async () => {
    const prodTokenEndpoint = 'https://okta.brightmls.invalid-tld/oauth2/default/v1/token';
    const prodServiceRoot = 'https://bright-reso.brightmls.invalid-tld/RESO/OData/bright';
    const server = createMockResoServer({
      tokenEndpoint: prodTokenEndpoint,
      serviceRoot: prodServiceRoot,
      records: { BrightProperties: listings(6) },
      pageSize: 4,
    });
    const memory = createMemoryStore();
    const { sink, records } = collectRecords();

    const result = await runBrightIngest({
      env: {
        [BRIGHT_ENV_VARS.tokenEndpoint]: prodTokenEndpoint,
        [BRIGHT_ENV_VARS.serviceRoot]: prodServiceRoot,
        [BRIGHT_ENV_VARS.env]: 'production',
        [BRIGHT_ENV_VARS.prodClientId]: 'fixture-prod-client-id',
        [BRIGHT_ENV_VARS.prodClientSecret]: 'fixture-prod-client-secret',
      },
      sink,
      fetchImpl: server.fetchImpl,
      store: memory.store,
      sleep: () => Promise.resolve(),
      random: () => 0,
    });

    expect(result.outcome).toBe('replicated');
    expect((records[1] as BrightRunFinishedRecord).feed).toBe('production');
  });

  /**
   * A resync that silently did not happen is the worst of the three outcomes. `true` is the likely
   * guess for a boolean flag, and reading it as false would leave the cursor in place with nothing
   * in the log to say so.
   */
  it('rejects a full-resync value other than 1 or 0 rather than reading it as false', async () => {
    const { sink } = collectRecords();
    const result = await runBrightIngest({
      env: configuredEnv({ [BRIGHT_ENV_VARS.fullResync]: 'true' }),
      sink,
      fetchImpl: stubFetch([]).fetchImpl,
    });

    expect(result.outcome).toBe('failed');
    expect(result.message).toContain(BRIGHT_ENV_VARS.fullResync);
  });

  it('rejects a feed value that is neither tier', async () => {
    const { sink } = collectRecords();
    const result = await runBrightIngest({
      env: configuredEnv({ [BRIGHT_ENV_VARS.feed]: 'prod' }),
      sink,
      fetchImpl: stubFetch([]).fetchImpl,
    });

    expect(result.outcome).toBe('failed');
    expect(result.message).toContain('must be "test" or "production"');
  });
});

describe('runBrightIngest — failure', () => {
  it('reports a rejected credential as failed, carrying the OAuth2 error code', async () => {
    const { sink, records } = collectRecords();
    const { fetchImpl } = stubFetch([
      {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        body: JSON.stringify({ error: 'invalid_client', error_description: 'Bad credentials' }),
      },
    ]);

    const result = await runBrightIngest({ env: configuredEnv(), sink, fetchImpl });

    expect(result.outcome).toBe('failed');
    expect(result.message).toContain('invalid_client');
    expect(result.message).toContain('bright-staging.example.test');
    // The description is dropped, not surfaced — see below for why.
    expect(result.message).not.toContain('Bad credentials');
    expect(records.map((r) => r.event)).toEqual(['run_started', 'run_finished']);
  });

  /**
   * `message` is the one free-text field on a run record, so it is the one place server-supplied
   * content could reach a log line. A gateway that answers `error_description: "Client 'x' not
   * found"` would otherwise log our client id — which would quietly defeat the structural redaction
   * claim, since no scrubber can un-log free text somebody already routed onto the record.
   */
  it('never echoes a server-supplied error description, even one containing the client id', async () => {
    const { sink, records } = collectRecords();
    const { fetchImpl } = stubFetch([
      {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        body: JSON.stringify({
          error: 'invalid_client',
          error_description: `Client '${CLIENT_ID}' not found`,
        }),
      },
    ]);

    const result = await runBrightIngest({ env: configuredEnv(), sink, fetchImpl });

    expect(result.message).not.toContain(CLIENT_ID);
    expect(records.map((r) => JSON.stringify(r)).join('\n')).not.toContain(CLIENT_ID);
  });

  /** An unrecognised code is reported as such rather than echoed, on the same reasoning. */
  it('does not echo an unrecognised error code', async () => {
    const { sink } = collectRecords();
    const { fetchImpl } = stubFetch([
      {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        body: JSON.stringify({ error: `leaked-${CLIENT_SECRET}` }),
      },
    ]);

    const result = await runBrightIngest({ env: configuredEnv(), sink, fetchImpl });

    expect(result.message).toContain('unrecognized_error_code');
    expect(result.message).not.toContain(CLIENT_SECRET);
  });

  /**
   * A misconfiguration is present-but-wrong, which is the opposite case from absent. It must fail
   * rather than being absorbed into "no credentials yet".
   */
  it('fails on an unusable endpoint rather than reporting it as not configured', async () => {
    const { sink, records } = collectRecords();
    const result = await runBrightIngest({
      env: configuredEnv({ [BRIGHT_ENV_VARS.serviceRoot]: 'http://insecure-test.example.test' }),
      sink,
      fetchImpl: stubFetch([]).fetchImpl,
    });

    expect(result.outcome).toBe('failed');
    expect(result.message).toMatch(/https/i);
    // The terminal record is emitted on every path — a run nobody can account for is the failure
    // mode the structured log exists to prevent.
    expect(records.map((r) => r.event)).toEqual(['run_started', 'run_finished']);
  });

  it('fails on an unknown configured resource rather than replicating nothing', async () => {
    const { invoke } = mockRun({
      env: configuredEnv({ [BRIGHT_ENV_VARS.resources]: 'Property' }),
    });
    await expect(invoke()).resolves.toMatchObject({ outcome: 'failed' });
  });

  it('never throws, so the CronJob pod always gets a terminal record and a chosen exit code', async () => {
    const throwingFetch: FetchLike = () => Promise.reject(new Error('ECONNREFUSED'));
    const { sink, records } = collectRecords();

    await expect(
      runBrightIngest({ env: configuredEnv(), sink, fetchImpl: throwingFetch }),
    ).resolves.toMatchObject({ outcome: 'failed' });
    expect(records).toHaveLength(2);
  });

  /**
   * Node's global fetch rejects with the bare string `fetch failed` and hides the real reason on
   * `error.cause`. Unwrapped, that message in a nightly log cannot distinguish "Bright is down"
   * from "the endpoint has a typo" from "egress is blocked" — three different people's problem.
   */
  it('names the host and the underlying cause on a transport failure', async () => {
    const opaque = new Error('fetch failed');
    (opaque as Error & { cause?: unknown }).cause = new Error('getaddrinfo ENOTFOUND');
    const { sink } = collectRecords();

    const result = await runBrightIngest({
      env: configuredEnv(),
      sink,
      fetchImpl: () => Promise.reject(opaque),
    });

    expect(result.outcome).toBe('failed');
    expect(result.message).toContain('bright-staging.example.test');
    expect(result.message).toContain('getaddrinfo ENOTFOUND');
  });

  /**
   * A pass that staged rows and then failed has still moved its cursor, because the cursor advances
   * inside the transaction that writes each page. A report that hid those rows would make the next
   * run look like it skipped work.
   */
  it('keeps the counts of whatever completed before the failure', async () => {
    const { memory, invoke } = mockRun({
      env: configuredEnv({ [BRIGHT_ENV_VARS.maxRetries]: '0' }),
      records: { BrightProperties: listings(9) },
      pageSize: 3,
      // The first page succeeds, the second is a 400, which is not retryable.
      failures: [0, 400],
    });

    const result = await invoke();

    expect(result.outcome).toBe('failed');
    expect(result.counts.recordsStaged).toBe(3);
    expect(memory.rows.size).toBe(3);
  });
});

describe('runBrightIngest — redaction', () => {
  /**
   * The containment is structural: no log record type has a field a credential could be assigned to.
   * This test is the enforcement. If it fails, do not add a scrubbing pass — a scrubber is a list of
   * things somebody remembered. Take the field off the record type instead.
   */
  it('emits no credential material on any record, on a replicated run', async () => {
    const { records, invoke } = mockRun({ records: { BrightProperties: listings(4) } });
    await invoke();

    const serialised = records.map((record) => JSON.stringify(record)).join('\n');
    expect(serialised).not.toContain(CLIENT_SECRET);
    expect(serialised).not.toContain(CLIENT_ID);
    // The access token is Bright's, but it is still bearer material and still not log content.
    expect(serialised).not.toContain('mock-access-token');
    // Hosts are logged; full URLs are not, because a token endpoint's query string is a plausible
    // place for a credential to end up.
    expect(serialised).toContain('bright-staging.example.test');
    expect(serialised).not.toContain(TOKEN_ENDPOINT);
    expect(serialised).not.toContain(SERVICE_ROOT);
  });

  it('emits no credential material on a failed run either', async () => {
    const { sink, records } = collectRecords();
    await runBrightIngest({
      env: configuredEnv(),
      sink,
      fetchImpl: stubFetch([
        { ok: false, status: 401, statusText: 'Unauthorized', body: '{"error":"invalid_client"}' },
      ]).fetchImpl,
    });

    const serialised = records.map((record) => JSON.stringify(record)).join('\n');
    expect(serialised).not.toContain(CLIENT_SECRET);
    expect(serialised).not.toContain(CLIENT_ID);
    expect(serialised).toContain('bright-staging.example.test');
    expect(serialised).not.toContain(TOKEN_ENDPOINT);
  });

  /** A staged payload is Bright's data, not ours, but a run record must not carry it either. */
  it('puts no record payload on a run record', async () => {
    const { records, invoke } = mockRun({
      records: {
        BrightProperties: [
          {
            ListingKey: 8001,
            ModificationTimestamp: '2026-09-02T00:00:00.000Z',
            UnparsedAddress: '142 Oak St',
          },
        ],
      },
    });
    await invoke();

    expect(records.map((r) => JSON.stringify(r)).join('\n')).not.toContain('142 Oak St');
  });
});
