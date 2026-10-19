'use strict';

/**
 * Dev availability probe (#963). Runs in a short-lived pod inside the dev cluster.
 * It reads five in-cluster targets in sequence and reports status counts and latency per target.
 * The exit code is 1 if any read returned a status other than 200.
 *
 * Env: WEB_BASE_URL, GATEWAY_BASE_URL, PROBE_CLIENT_IP, DURATION_SECONDS, INTERVAL_SECONDS,
 * DEPLOY_AT_SECONDS (report only).
 */

const REQUEST_TIMEOUT_MS = 10_000;
const MIN_INTERVAL_SECONDS = 2;
const MAX_DURATION_SECONDS = 3600;
const HOME_ROW_QUERY = 'listingType=sale&sort=newly-listed&pageSize=15&skipTotal=true';
const DISCOVERY_ATTEMPTS = 5;
const SUMMARY_MARKER = '--- summary ---';

function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function parseConfig(env) {
  return {
    durationSeconds: clampInt(env.DURATION_SECONDS, 600, 1, MAX_DURATION_SECONDS),
    intervalSeconds: clampInt(env.INTERVAL_SECONDS, 2, MIN_INTERVAL_SECONDS, MAX_DURATION_SECONDS),
  };
}

/** Nearest-rank percentile of an unsorted list. Returns null for an empty list. */
function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

/** A sample is `{ status, ms }`. Status 0 is a timeout or a network error. */
function longestErrorStreak(samples) {
  let longest = 0;
  let current = 0;
  for (const s of samples) {
    current = s.status === 200 ? 0 : current + 1;
    longest = Math.max(longest, current);
  }
  return longest;
}

function summarize(samples) {
  const byStatus = {};
  for (const s of samples) byStatus[s.status] = (byStatus[s.status] || 0) + 1;
  const times = samples.map((s) => s.ms);
  return {
    total: samples.length,
    byStatus,
    nonOk: samples.filter((s) => s.status !== 200).length,
    p50: percentile(times, 50),
    p95: percentile(times, 95),
    max: times.length ? Math.max(...times) : null,
    longestErrorStreak: longestErrorStreak(samples),
  };
}

function formatStatuses(byStatus) {
  const keys = Object.keys(byStatus).sort((a, b) => Number(a) - Number(b));
  if (keys.length === 0) return '-';
  return keys.map((k) => `${k === '0' ? 'err' : k}: ${byStatus[k]}`).join(', ');
}

const fmtMs = (v) => (v === null ? '-' : `${Math.round(v)}`);

/** `results` maps a target name to its samples. */
function renderMarkdown(results, meta) {
  const deploy = meta.deployAtSeconds === null ? 'no' : `yes, at ${meta.deployAtSeconds} s`;
  const lines = [
    '## Dev availability probe',
    '',
    `Duration: ${meta.durationSeconds} s. Interval: ${meta.intervalSeconds} s. Deploy dispatched: ${deploy}.`,
    '',
    '| Target | Reads | Statuses | Non-200 | p50 ms | p95 ms | Max ms | Longest error streak |',
    '| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |',
  ];
  let nonOk = 0;
  for (const [name, samples] of Object.entries(results)) {
    const s = summarize(samples);
    nonOk += s.nonOk;
    lines.push(
      `| ${name} | ${s.total} | ${formatStatuses(s.byStatus)} | ${s.nonOk} | ${fmtMs(s.p50)} | ${fmtMs(s.p95)} | ${fmtMs(s.max)} | ${s.longestErrorStreak} |`,
    );
  }
  lines.push(
    '',
    nonOk === 0 ? 'Result: every read returned 200.' : `Result: ${nonOk} non-200 reads.`,
  );
  return lines.join('\n');
}

/** First `results[].propertyId` of a listings envelope, or null. */
function firstListingId(body) {
  const id = body && Array.isArray(body.results) ? body.results[0]?.propertyId : null;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : null;
}

function buildTargets({ webBase, gatewayBase, listingId }) {
  return [
    { name: 'web home page', url: `${webBase}/` },
    { name: 'web /api/health', url: `${webBase}/api/health` },
    { name: 'web home-row read', url: `${webBase}/api/listings?${HOME_ROW_QUERY}` },
    { name: 'gateway home-row read', url: `${gatewayBase}/property/listings?${HOME_ROW_QUERY}` },
    {
      name: 'gateway listing detail',
      url: `${gatewayBase}/property/listings/${encodeURIComponent(listingId)}`,
    },
  ];
}

async function timedRead(url, headers, fetchImpl = fetch) {
  const started = performance.now();
  try {
    const res = await fetchImpl(url, {
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await res.text();
    return { status: res.status, ms: performance.now() - started, text };
  } catch {
    // An error message can carry the host name, so only status 0 is kept.
    return { status: 0, ms: performance.now() - started, text: '' };
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function discoverListingId(gatewayBase, headers) {
  for (let i = 0; i < DISCOVERY_ATTEMPTS; i += 1) {
    const read = await timedRead(`${gatewayBase}/property/listings?${HOME_ROW_QUERY}`, headers);
    if (read.status === 200) {
      try {
        const id = firstListingId(JSON.parse(read.text));
        if (id) return id;
      } catch {
        // Retry.
      }
    }
    await sleep(MIN_INTERVAL_SECONDS * 1000);
  }
  return null;
}

function trimBase(url) {
  return url.replace(/\/+$/, '');
}

/** The gateway rate limit keys on X-Real-IP. The probe sends its own pod IP, so it has its own quota. */
function buildHeaders(clientIp) {
  const headers = { Accept: 'application/json, text/html' };
  if (clientIp) {
    headers['X-Real-IP'] = clientIp;
    headers['X-Forwarded-For'] = clientIp;
  }
  return headers;
}

async function main(env = process.env) {
  const config = parseConfig(env);
  const webBase = trimBase(env.WEB_BASE_URL || 'http://cribstop-web-svc:3000');
  const gatewayBase = trimBase(env.GATEWAY_BASE_URL || 'http://api-gateway-svc:8080');
  const headers = buildHeaders(env.PROBE_CLIENT_IP);

  const listingId = await discoverListingId(gatewayBase, headers);
  if (!listingId) {
    console.error('Could not read a listing id from the gateway home-row read.');
    return 1;
  }

  const targets = buildTargets({ webBase, gatewayBase, listingId });
  const results = Object.fromEntries(targets.map((t) => [t.name, []]));
  const deployAtSeconds = env.DEPLOY_AT_SECONDS ? Number(env.DEPLOY_AT_SECONDS) : null;
  const end = Date.now() + config.durationSeconds * 1000;
  console.log(`Probe started: ${targets.length} targets, ${config.durationSeconds} s.`);

  while (Date.now() < end) {
    const tickStart = Date.now();
    for (const target of targets) {
      const { status, ms } = await timedRead(target.url, headers);
      results[target.name].push({ status, ms });
      if (status !== 200) {
        console.log(
          `non-200: ${target.name}, status ${status === 0 ? 'err' : status}, ${Math.round(ms)} ms`,
        );
      }
    }
    const wait = config.intervalSeconds * 1000 - (Date.now() - tickStart);
    if (wait > 0) await sleep(wait);
  }

  const markdown = renderMarkdown(results, { ...config, deployAtSeconds });
  console.log(`${SUMMARY_MARKER}\n${markdown}`);
  return Object.values(results).some((samples) => samples.some((s) => s.status !== 200)) ? 1 : 0;
}

module.exports = {
  parseConfig,
  percentile,
  longestErrorStreak,
  summarize,
  renderMarkdown,
  firstListingId,
  buildTargets,
  timedRead,
  trimBase,
  buildHeaders,
  SUMMARY_MARKER,
  main,
};

if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    () => {
      console.error('Probe crashed.');
      process.exit(1);
    },
  );
}
