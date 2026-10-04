import type { Queryable } from '../write';
import { type DeliveryChannel, DeliveryError } from './channel';
import type { DeliveryTuning, SendResolution } from './config';
import { buildIntakeMessage } from './message';
import {
  claimDueInquiries,
  failAbandoned,
  markSampleInquiries,
  recordDelivered,
  recordFailed,
  recordRetry,
  summarizeOverdue,
} from './store';

/**
 * The inquiry delivery worker (#134). It runs inside the property-service process. The consumer
 * submit never waits on it. Each tick: mark sample inquiries, claim due rows, send each through the
 * channel, record the outcome, then report any inquiry that stays undelivered past the age limit.
 *
 * Log lines are one JSON object each. `event: "inquiry_delivery_overdue"` is the alertable
 * condition. No consumer data appears in a log line.
 */

export type DeliveryLogger = (
  level: 'info' | 'warn' | 'error',
  entry: Record<string, unknown>,
) => void;

export const jsonLogger: DeliveryLogger = (level, entry) => {
  const line = JSON.stringify({ component: 'inquiry-delivery', level, ...entry });
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.info(line);
  }
};

export interface DeliveryWorkerDeps {
  db: Queryable;
  /** Null while sending is disabled. The reason is in `resolution.disabledReason`. */
  channel: DeliveryChannel | null;
  resolution: SendResolution;
  tuning: DeliveryTuning;
  log: DeliveryLogger;
}

export function backoffMs(tuning: DeliveryTuning, attempt: number): number {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(tuning.maxBackoffMs, tuning.baseBackoffMs * 2 ** exponent);
}

export interface TickResult {
  sampled: number;
  delivered: number;
  retried: number;
  failed: number;
  overdue: number;
}

export async function runDeliveryTick(deps: DeliveryWorkerDeps): Promise<TickResult> {
  const { db, channel, resolution, tuning, log } = deps;
  const result: TickResult = { sampled: 0, delivered: 0, retried: 0, failed: 0, overdue: 0 };

  result.sampled = await markSampleInquiries(db);
  if (result.sampled > 0) {
    log('info', { event: 'inquiry_delivery_sample_skipped', count: result.sampled });
  }

  if (channel !== null && resolution.send !== null) {
    const abandoned = await failAbandoned(db, tuning);
    result.failed += abandoned;

    const claimed = await claimDueInquiries(db, tuning);
    for (const inquiry of claimed) {
      const message = buildIntakeMessage(inquiry, {
        intakeAddress: resolution.send.intakeAddress,
        fromAddress: resolution.send.fromAddress,
        siteOrigin: tuning.siteOrigin,
      });
      let messageId: string;
      try {
        messageId = (await channel.send(message)).messageId;
      } catch (error) {
        const retryable = error instanceof DeliveryError ? error.retryable : true;
        const text = error instanceof Error ? error.message : 'Unknown delivery error.';
        try {
          if (!retryable || inquiry.delivery_attempts >= tuning.maxAttempts) {
            await recordFailed(db, inquiry.id, text);
            result.failed += 1;
            log('error', {
              event: 'inquiry_delivery_failed',
              inquiryId: inquiry.id,
              attempts: inquiry.delivery_attempts,
              retryable,
              error: text,
            });
          } else {
            const delay = backoffMs(tuning, inquiry.delivery_attempts);
            await recordRetry(db, inquiry.id, text, delay);
            result.retried += 1;
            log('warn', {
              event: 'inquiry_delivery_retry',
              inquiryId: inquiry.id,
              attempts: inquiry.delivery_attempts,
              retryInMs: delay,
              error: text,
            });
          }
        } catch (recordError) {
          // The row stays 'sending'. The lease expiry makes it due again.
          log('error', {
            event: 'inquiry_delivery_record_failed',
            inquiryId: inquiry.id,
            error: recordError instanceof Error ? recordError.message : 'Unknown error.',
          });
        }
        continue;
      }
      // The send succeeded. A failure to record it must not count as a send failure. A retry
      // would send a duplicate. The lease expiry makes the row due again.
      try {
        await recordDelivered(db, inquiry.id, messageId);
        result.delivered += 1;
        log('info', {
          event: 'inquiry_delivered',
          inquiryId: inquiry.id,
          messageId,
          attempts: inquiry.delivery_attempts,
        });
      } catch (recordError) {
        log('error', {
          event: 'inquiry_delivery_record_failed',
          inquiryId: inquiry.id,
          messageId,
          error: recordError instanceof Error ? recordError.message : 'Unknown error.',
        });
      }
    }
  }

  const overdue = await summarizeOverdue(db, tuning.overdueAgeMs);
  result.overdue = overdue.count;
  if (overdue.count > 0) {
    log('error', {
      event: 'inquiry_delivery_overdue',
      count: overdue.count,
      oldestAgeSeconds: overdue.oldestAgeSeconds,
      overdueAgeMs: tuning.overdueAgeMs,
      sendingEnabled: resolution.send !== null,
      ...(resolution.disabledReason === null ? {} : { disabledReason: resolution.disabledReason }),
    });
  }
  return result;
}

export interface DeliveryWorkerHandle {
  stop(): void;
}

/** Starts the loop. A tick never overlaps the next. A tick error is logged and the loop goes on. */
export function startDeliveryWorker(deps: DeliveryWorkerDeps): DeliveryWorkerHandle {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  if (deps.resolution.send === null) {
    deps.log('warn', {
      event: 'inquiry_delivery_disabled',
      reason: deps.resolution.disabledReason,
    });
  }

  const schedule = (): void => {
    if (stopped) {
      return;
    }
    timer = setTimeout(() => {
      runDeliveryTick(deps)
        .catch((error: unknown) => {
          deps.log('error', {
            event: 'inquiry_delivery_tick_error',
            error: error instanceof Error ? error.message : 'Unknown error.',
          });
        })
        .finally(schedule);
    }, deps.tuning.intervalMs);
    timer.unref();
  };
  schedule();

  return {
    stop() {
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
    },
  };
}
