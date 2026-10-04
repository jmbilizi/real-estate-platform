import { SECRET_PLACEHOLDER } from '../../jobs/bright-ingest/config';

/**
 * Configuration for inquiry delivery to the Cribstop buyer-agent intake (#134).
 *
 * Sending fails closed. All of these must hold, or nothing is sent and the worker says why:
 *  - `INQUIRY_EXTERNAL_SEND=true`. Only configuration grants permission to send externally. No
 *    environment name and no developer flag does (the #93 rule).
 *  - `POSTMARK_SERVER_TOKEN` is set and is not the committed placeholder.
 *  - `INQUIRY_INTAKE_ADDRESS` and `INQUIRY_FROM_ADDRESS` are set.
 *
 * The recipient is `INQUIRY_INTAKE_ADDRESS` only. It never comes from a request or a listing.
 */

export const DELIVERY_ENV_VARS = {
  externalSend: 'INQUIRY_EXTERNAL_SEND',
  token: 'POSTMARK_SERVER_TOKEN',
  intakeAddress: 'INQUIRY_INTAKE_ADDRESS',
  fromAddress: 'INQUIRY_FROM_ADDRESS',
} as const;

export interface SendConfig {
  token: string;
  intakeAddress: string;
  fromAddress: string;
  messageStream: string;
  apiBaseUrl: string;
  requestTimeoutMs: number;
}

export interface DeliveryTuning {
  intervalMs: number;
  batchSize: number;
  maxAttempts: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  /** A `sending` row older than this lost its worker and may be claimed again. */
  leaseMs: number;
  /** An inquiry not delivered after this age is an alertable condition. */
  overdueAgeMs: number;
  /** Public web origin for the listing link. Empty means the message carries the ID only. */
  siteOrigin: string | null;
}

export type SendResolution =
  | { send: SendConfig; disabledReason: null }
  | { send: null; disabledReason: string };

type Env = Readonly<Record<string, string | undefined>>;

function present(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '' && value.trim() !== SECRET_PLACEHOLDER;
}

function positiveInt(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number(raw);
  // The SQL casts these to int4, so a larger value would fail on every tick.
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 2_000_000_000 ? parsed : fallback;
}

export function resolveSendConfig(env: Env): SendResolution {
  if (env[DELIVERY_ENV_VARS.externalSend]?.trim() !== 'true') {
    return {
      send: null,
      disabledReason: `${DELIVERY_ENV_VARS.externalSend} is not "true". This environment has not declared permission to send externally.`,
    };
  }
  const missing = [
    DELIVERY_ENV_VARS.token,
    DELIVERY_ENV_VARS.intakeAddress,
    DELIVERY_ENV_VARS.fromAddress,
  ].filter((name) => !present(env[name]));
  if (missing.length > 0) {
    return {
      send: null,
      disabledReason: `Not configured: ${missing.join(', ')} (unset or placeholder).`,
    };
  }
  return {
    send: {
      token: (env[DELIVERY_ENV_VARS.token] as string).trim(),
      intakeAddress: (env[DELIVERY_ENV_VARS.intakeAddress] as string).trim(),
      fromAddress: (env[DELIVERY_ENV_VARS.fromAddress] as string).trim(),
      messageStream: env.INQUIRY_POSTMARK_MESSAGE_STREAM?.trim() || 'outbound',
      apiBaseUrl: env.POSTMARK_API_BASE_URL?.trim() || 'https://api.postmarkapp.com',
      requestTimeoutMs: positiveInt(env, 'INQUIRY_DELIVERY_REQUEST_TIMEOUT_MS', 10_000),
    },
    disabledReason: null,
  };
}

export function resolveDeliveryTuning(env: Env): DeliveryTuning {
  const origin = env.INQUIRY_SITE_ORIGIN?.trim().replace(/\/+$/, '');
  return {
    intervalMs: positiveInt(env, 'INQUIRY_DELIVERY_INTERVAL_MS', 30_000),
    batchSize: positiveInt(env, 'INQUIRY_DELIVERY_BATCH_SIZE', 10),
    maxAttempts: positiveInt(env, 'INQUIRY_DELIVERY_MAX_ATTEMPTS', 8),
    baseBackoffMs: positiveInt(env, 'INQUIRY_DELIVERY_BASE_BACKOFF_MS', 30_000),
    maxBackoffMs: positiveInt(env, 'INQUIRY_DELIVERY_MAX_BACKOFF_MS', 30 * 60_000),
    leaseMs: positiveInt(env, 'INQUIRY_DELIVERY_LEASE_MS', 5 * 60_000),
    overdueAgeMs: positiveInt(env, 'INQUIRY_DELIVERY_OVERDUE_AGE_MS', 15 * 60_000),
    siteOrigin: origin ? origin : null,
  };
}
