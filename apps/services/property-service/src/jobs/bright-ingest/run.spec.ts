import type { FetchLike } from './bright-client';
import { BRIGHT_ENV_VARS, SECRET_PLACEHOLDER } from './config';
import { runBrightIngest } from './run';
import type { BrightRunRecord } from './run-log';

const CLIENT_ID = 'fixture-client-id-3f9a';
const CLIENT_SECRET = 'fixture-client-secret-91b2c7';

function configuredEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    [BRIGHT_ENV_VARS.tokenEndpoint]: 'https://bright-staging.example.test/oauth/token',
    [BRIGHT_ENV_VARS.serviceRoot]: 'https://api-staging.example.test/reso/odata/',
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
   * An unwired environment holds the committed placeholder. This is the exact shape of a run in
   * those environments, and it must be a clean completion — not a 401, not a failed Job.
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

  it('reports zero counts, so the siblings have a shape to populate rather than invent', async () => {
    const { sink } = collectRecords();
    const result = await runBrightIngest({ env: {}, sink, fetchImpl: stubFetch([]).fetchImpl });

    expect(result.counts).toEqual({ recordsFetched: 0, recordsStaged: 0, recordsUpserted: 0 });
  });
});

describe('runBrightIngest — configured', () => {
  it('authenticates, probes $metadata, and reports the hosts it actually used', async () => {
    const { sink, records } = collectRecords();
    const { fetchImpl, calls } = stubFetch([
      { body: JSON.stringify({ access_token: 'token-abc', expires_in: 3600 }) },
      { headers: { 'OData-Version': '4.0' }, body: '<edmx:Edmx Version="4.0"/>' },
    ]);

    const result = await runBrightIngest({
      env: configuredEnv(),
      sink,
      fetchImpl,
      now: fixedClock('2026-09-15T03:00:00.000Z', 1_250),
    });

    expect(result.outcome).toBe('probe_succeeded');
    expect(result.durationMs).toBe(1_250);
    expect(result.tokenEndpointHost).toBe('bright-staging.example.test');

    expect(calls).toHaveLength(2);
    const [tokenCall, metadataCall] = calls;
    expect(tokenCall?.method).toBe('POST');
    expect(tokenCall?.body).toContain('grant_type=client_credentials');
    // The service root is normalised by URL() and keeps its trailing slash; joining must not
    // produce `//$metadata`, which many gateways 404 rather than normalise.
    expect(metadataCall?.url).toBe('https://api-staging.example.test/reso/odata/$metadata');
    expect(metadataCall?.headers.Authorization).toBe('Bearer token-abc');

    const finished = records[1];
    expect(finished).toMatchObject({
      event: 'run_finished',
      outcome: 'probe_succeeded',
      metadata: { odataVersion: '4.0', byteLength: 26 },
    });
  });

  /** Ingestion is #92/#93. A run that quietly started writing rows would be the real defect here. */
  it('makes exactly two requests and ingests nothing', async () => {
    const { sink } = collectRecords();
    const { fetchImpl, calls } = stubFetch([
      { body: JSON.stringify({ access_token: 'token-abc' }) },
      { body: '<edmx/>' },
    ]);

    const result = await runBrightIngest({ env: configuredEnv(), sink, fetchImpl });

    expect(calls).toHaveLength(2);
    expect(result.counts).toEqual({ recordsFetched: 0, recordsStaged: 0, recordsUpserted: 0 });
  });
});

describe('runBrightIngest — failure', () => {
  it('reports a rejected credential as failed, carrying the OAuth2 error fields', async () => {
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
      env: configuredEnv({ [BRIGHT_ENV_VARS.serviceRoot]: 'http://insecure.example.test' }),
      sink,
      fetchImpl: stubFetch([]).fetchImpl,
    });

    expect(result.outcome).toBe('failed');
    expect(result.message).toMatch(/https/i);
    // The terminal record is emitted on every path — a run nobody can account for is the failure
    // mode the structured log exists to prevent.
    expect(records.map((r) => r.event)).toEqual(['run_started', 'run_finished']);
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
});

describe('runBrightIngest — redaction', () => {
  /**
   * The containment is structural: no log record type has a field a credential could be assigned to.
   * This test is the enforcement. If it fails, do not add a scrubbing pass — a scrubber is a list of
   * things somebody remembered. Take the field off the record type instead.
   */
  it('emits no credential material on any record, on success or failure', async () => {
    for (const responses of [
      [{ body: JSON.stringify({ access_token: 'token-abc' }) }, { body: '<edmx/>' }],
      [{ ok: false, status: 401, statusText: 'Unauthorized', body: '{"error":"invalid_client"}' }],
    ]) {
      const { sink, records } = collectRecords();
      await runBrightIngest({
        env: configuredEnv(),
        sink,
        fetchImpl: stubFetch(responses).fetchImpl,
      });

      const serialised = records.map((record) => JSON.stringify(record)).join('\n');
      expect(serialised).not.toContain(CLIENT_SECRET);
      expect(serialised).not.toContain(CLIENT_ID);
      // The access token is Bright's, but it is still bearer material and still not log content.
      expect(serialised).not.toContain('token-abc');
      // Hosts are logged; full URLs are not, because a token endpoint's query string is a
      // plausible place for a credential to end up.
      expect(serialised).toContain('bright-staging.example.test');
      expect(serialised).not.toContain('https://bright-staging.example.test/oauth/token');
    }
  });
});
