const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  PropertyDbUrlError,
  buildLocalUrl,
  deriveDatabaseUrl,
  expandKubeRefs,
  parseArgs,
  readDeploymentEnv,
  readForwardedPostgresPort,
  redactUrl,
  setEnvFileKey,
  splitUrlTemplate,
} = require('./property-db-url');

const LOCAL_CONTEXT = 'kind-myapp-podman-local';

/** A spawnSync stand-in. Answers the context probe, then the Deployment read. */
function fakeRunner({ context = LOCAL_CONTEXT, deployment } = {}) {
  return (command, args) => {
    if (args[0] === 'config') {
      return context === null
        ? { status: 1, stdout: '', stderr: 'no context' }
        : { status: 0, stdout: `${context}\n`, stderr: '' };
    }
    if (args[0] === 'get' && args[1] === 'deployment') {
      return deployment || { status: 1, stdout: '', stderr: 'Error: deployments "x" not found' };
    }
    throw new Error(`unexpected kubectl call: ${args.join(' ')}`);
  };
}

function deploymentJson(env) {
  return {
    status: 0,
    stderr: '',
    stdout: JSON.stringify({ spec: { template: { spec: { containers: [{ env }] } } } }),
  };
}

const STANDARD_ENV = [
  { name: 'PROPERTY_DB_HOST', value: 'postgres-svc' },
  { name: 'PROPERTY_DB_PORT', value: '5432' },
  { name: 'PROPERTY_DB_NAME', value: 'property_db' },
  { name: 'PROPERTY_DB_USER', value: 'property_service_db_user' },
  { name: 'PROPERTY_SERVICE_DB_USER_PASSWORD', valueFrom: { secretKeyRef: {} } },
  {
    name: 'DATABASE_URL',
    value:
      'postgresql://$(PROPERTY_DB_USER):$(PROPERTY_SERVICE_DB_USER_PASSWORD)' +
      '@$(PROPERTY_DB_HOST):$(PROPERTY_DB_PORT)/$(PROPERTY_DB_NAME)',
  },
];

function tempSkaffold(body) {
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'property-db-url-')),
    'skaffold.yaml',
  );
  fs.writeFileSync(file, body);
  return file;
}

const SKAFFOLD_WITH_FORWARD = `apiVersion: skaffold/v4beta11
kind: Config
portForward:
  - resourceType: service
    resourceName: postgres-svc
    port: 5432
    localPort: 5433
`;

test('derives the URL from the Deployment, the Secret and the port-forward', async () => {
  const result = await deriveDatabaseUrl({
    runner: fakeRunner({ deployment: deploymentJson(STANDARD_ENV) }),
    readSecret: () => ({ PROPERTY_SERVICE_DB_USER_PASSWORD: 's3cret' }),
    skaffoldPath: tempSkaffold(SKAFFOLD_WITH_FORWARD),
    probe: async () => true,
  });

  assert.equal(result.port, 5433);
  assert.equal(
    result.url,
    'postgresql://property_service_db_user:s3cret@localhost:5433/property_db',
  );
});

test('refuses a context that is not the local cluster, and names the fix', async () => {
  await assert.rejects(
    deriveDatabaseUrl({
      runner: fakeRunner({ context: 'hetzner-prod' }),
      readSecret: () => ({}),
      skaffoldPath: tempSkaffold(SKAFFOLD_WITH_FORWARD),
      probe: async () => true,
    }),
    (error) => {
      assert.ok(error instanceof PropertyDbUrlError);
      assert.match(error.message, /hetzner-prod/);
      assert.match(error.message, /infra:local:cluster:setup/);
      return true;
    },
  );
});

test('refuses when the Deployment is absent, and names the fix', async () => {
  await assert.rejects(
    deriveDatabaseUrl({
      runner: fakeRunner({ deployment: null }),
      readSecret: () => ({}),
      skaffoldPath: tempSkaffold(SKAFFOLD_WITH_FORWARD),
      probe: async () => true,
    }),
    (error) => {
      assert.ok(error instanceof PropertyDbUrlError);
      assert.match(error.message, /skaffold:services/);
      return true;
    },
  );
});

test('refuses when nothing answers on the forwarded port, and names the fix', async () => {
  await assert.rejects(
    deriveDatabaseUrl({
      runner: fakeRunner({ deployment: deploymentJson(STANDARD_ENV) }),
      readSecret: () => ({ PROPERTY_SERVICE_DB_USER_PASSWORD: 's3cret' }),
      skaffoldPath: tempSkaffold(SKAFFOLD_WITH_FORWARD),
      probe: async () => false,
    }),
    (error) => {
      assert.ok(error instanceof PropertyDbUrlError);
      assert.match(error.message, /localhost:5433/);
      assert.match(error.message, /skaffold:services/);
      return true;
    },
  );
});

test('refuses when the Secret supplies no password, rather than building a blank credential', async () => {
  await assert.rejects(
    deriveDatabaseUrl({
      runner: fakeRunner({ deployment: deploymentJson(STANDARD_ENV) }),
      readSecret: () => ({}),
      skaffoldPath: tempSkaffold(SKAFFOLD_WITH_FORWARD),
      probe: async () => true,
    }),
    (error) => {
      assert.ok(error instanceof PropertyDbUrlError);
      assert.match(error.message, /PROPERTY_SERVICE_DB_USER_PASSWORD/);
      return true;
    },
  );
});

test('refuses when the Secret itself is absent', async () => {
  await assert.rejects(
    deriveDatabaseUrl({
      runner: fakeRunner({ deployment: deploymentJson(STANDARD_ENV) }),
      readSecret: () => null,
      skaffoldPath: tempSkaffold(SKAFFOLD_WITH_FORWARD),
      probe: async () => true,
    }),
    (error) => {
      assert.ok(error instanceof PropertyDbUrlError);
      assert.match(error.message, /postgres-secret/);
      return true;
    },
  );
});

test('readDeploymentEnv reports a valueFrom entry as null', () => {
  const env = readDeploymentEnv(fakeRunner({ deployment: deploymentJson(STANDARD_ENV) }));
  assert.equal(env.PROPERTY_DB_NAME, 'property_db');
  assert.equal(env.PROPERTY_SERVICE_DB_USER_PASSWORD, null);
});

test('expandKubeRefs resolves every reference', () => {
  assert.equal(expandKubeRefs('a-$(ONE)-$(TWO)', { ONE: '1', TWO: '2' }), 'a-1-2');
});

test('expandKubeRefs refuses an empty reference rather than substituting nothing', () => {
  assert.throws(() => expandKubeRefs('$(ONE)', { ONE: '' }), PropertyDbUrlError);
  assert.throws(() => expandKubeRefs('$(MISSING)', {}), PropertyDbUrlError);
});

test('readForwardedPostgresPort falls back to the container port when localPort is absent', () => {
  const file = tempSkaffold(`apiVersion: skaffold/v4beta11
kind: Config
portForward:
  - resourceType: service
    resourceName: postgres-svc
    port: 5432
`);
  assert.equal(readForwardedPostgresPort(file), 5432);
});

test('readForwardedPostgresPort finds the entry in any document of a multi-module file', () => {
  const file = tempSkaffold(`apiVersion: skaffold/v4beta11
kind: Config
metadata:
  name: clients
---
apiVersion: skaffold/v4beta11
kind: Config
metadata:
  name: services
portForward:
  - resourceType: service
    resourceName: redis-svc
    port: 6379
    localPort: 6379
  - resourceType: service
    resourceName: postgres-svc
    port: 5432
    localPort: 5432
`);
  assert.equal(readForwardedPostgresPort(file), 5432);
});

test('readForwardedPostgresPort refuses when no postgres forward exists', () => {
  const file = tempSkaffold(`apiVersion: skaffold/v4beta11
kind: Config
portForward:
  - resourceType: service
    resourceName: redis-svc
    port: 6379
`);
  assert.throws(() => readForwardedPostgresPort(file), PropertyDbUrlError);
});

const TEMPLATE =
  'postgresql://$(PROPERTY_DB_USER):$(PROPERTY_SERVICE_DB_USER_PASSWORD)' +
  '@$(PROPERTY_DB_HOST):$(PROPERTY_DB_PORT)/$(PROPERTY_DB_NAME)';

function partsWith(password) {
  return {
    parts: splitUrlTemplate(TEMPLATE),
    values: {
      PROPERTY_DB_USER: 'property_service_db_user',
      PROPERTY_SERVICE_DB_USER_PASSWORD: password,
      PROPERTY_DB_HOST: 'postgres-svc',
      PROPERTY_DB_PORT: '5432',
      PROPERTY_DB_NAME: 'property_db',
    },
  };
}

test('splitUrlTemplate reads the template structure before any value is substituted', () => {
  const parts = splitUrlTemplate(TEMPLATE);
  assert.equal(parts.scheme, 'postgresql://');
  assert.equal(parts.user, '$(PROPERTY_DB_USER)');
  assert.equal(parts.password, '$(PROPERTY_SERVICE_DB_USER_PASSWORD)');
  assert.equal(parts.rest, '$(PROPERTY_DB_HOST):$(PROPERTY_DB_PORT)/$(PROPERTY_DB_NAME)');
});

test('splitUrlTemplate refuses a shape it cannot read', () => {
  assert.throws(() => splitUrlTemplate('postgresql://host/db'), PropertyDbUrlError);
});

test('buildLocalUrl points at localhost and the forwarded port', () => {
  const { parts, values } = partsWith('s3cret');
  assert.equal(
    buildLocalUrl(parts, values, 'localhost', 5433),
    'postgresql://property_service_db_user:s3cret@localhost:5433/property_db',
  );
});

test('buildLocalUrl percent-encodes a password containing @, so the authority stays unambiguous', () => {
  const { parts, values } = partsWith('p@ss');
  const url = buildLocalUrl(parts, values, 'localhost', 5432);
  assert.equal(url, 'postgresql://property_service_db_user:p%40ss@localhost:5432/property_db');
  assert.equal(new URL(url).password, 'p%40ss');
  assert.equal(decodeURIComponent(new URL(url).password), 'p@ss');
  assert.equal(new URL(url).hostname, 'localhost');
});

test('buildLocalUrl percent-encodes a base64 password containing / and +', () => {
  const { parts, values } = partsWith('a/b+c=');
  const url = buildLocalUrl(parts, values, 'localhost', 5432);
  assert.equal(new URL(url).hostname, 'localhost');
  assert.equal(new URL(url).pathname, '/property_db');
  assert.equal(decodeURIComponent(new URL(url).password), 'a/b+c=');
});

test('buildLocalUrl refuses an empty password rather than building a blank credential', () => {
  const { parts, values } = partsWith('');
  assert.throws(() => buildLocalUrl(parts, values, 'localhost', 5432), PropertyDbUrlError);
});

test('redactUrl hides the password and keeps the rest readable', () => {
  assert.equal(
    redactUrl('postgresql://user:s3cret@localhost:5432/property_db'),
    'postgresql://user:***@localhost:5432/property_db',
  );
});

test('redactUrl leaks no part of a password containing @', () => {
  const redacted = redactUrl('postgresql://user:p%40ss@localhost:5432/property_db');
  assert.equal(redacted, 'postgresql://user:***@localhost:5432/property_db');
  assert.ok(!redacted.includes('ss'), 'no fragment of the password may survive redaction');
});

test('redactUrl replaces a value it cannot parse, rather than redacting it partly', () => {
  assert.equal(redactUrl('not a url'), '<unprintable connection string>');
});

function tempEnvFile(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'property-db-env-'));
  const file = path.join(dir, '.env');
  if (body !== undefined) fs.writeFileSync(file, body);
  return file;
}

test('setEnvFileKey creates the file when it is absent', () => {
  const file = tempEnvFile();
  assert.equal(setEnvFileKey(file, 'DATABASE_URL', 'x'), 'created');
  assert.equal(fs.readFileSync(file, 'utf8'), 'DATABASE_URL=x\n');
});

test('setEnvFileKey replaces the key in place and keeps every other line', () => {
  const file = tempEnvFile('# header\nFIRST=1\nDATABASE_URL=old\nLAST=2\n');
  assert.equal(setEnvFileKey(file, 'DATABASE_URL', 'new'), 'replaced');
  assert.equal(fs.readFileSync(file, 'utf8'), '# header\nFIRST=1\nDATABASE_URL=new\nLAST=2\n');
});

test('setEnvFileKey replaces an exported key', () => {
  const file = tempEnvFile('export DATABASE_URL=old\nKEEP=1\n');
  assert.equal(setEnvFileKey(file, 'DATABASE_URL', 'new'), 'replaced');
  assert.equal(fs.readFileSync(file, 'utf8'), 'DATABASE_URL=new\nKEEP=1\n');
});

test('setEnvFileKey appends without leaving a blank gap', () => {
  const file = tempEnvFile('FIRST=1\n');
  assert.equal(setEnvFileKey(file, 'DATABASE_URL', 'x'), 'appended');
  assert.equal(fs.readFileSync(file, 'utf8'), 'FIRST=1\nDATABASE_URL=x\n');
});

test('setEnvFileKey keeps CRLF line endings', () => {
  const file = tempEnvFile('FIRST=1\r\nDATABASE_URL=old\r\n');
  setEnvFileKey(file, 'DATABASE_URL', 'new');
  assert.equal(fs.readFileSync(file, 'utf8'), 'FIRST=1\r\nDATABASE_URL=new\r\n');
});

test('setEnvFileKey replaces only the first match, so a duplicate key cannot shadow the write', () => {
  const file = tempEnvFile('DATABASE_URL=a\nDATABASE_URL=b\n');
  setEnvFileKey(file, 'DATABASE_URL', 'new');
  assert.equal(fs.readFileSync(file, 'utf8'), 'DATABASE_URL=new\nDATABASE_URL=b\n');
});

test('parseArgs accepts the documented flags and rejects anything else', () => {
  assert.equal(parseArgs([]).print, false);
  assert.equal(parseArgs(['--', '--print']).print, true);
  assert.match(parseArgs(['--env-file', 'sub/.env']).envFile, /sub[\\/]\.env$/);
  assert.throws(() => parseArgs(['--env-file']), PropertyDbUrlError);
  assert.throws(() => parseArgs(['--nope']), PropertyDbUrlError);
});
