import type { Queryable } from '../write';
import { createPostmarkChannel } from './postmark-channel';
import { resolveDeliveryTuning, resolveSendConfig } from './config';
import { type DeliveryWorkerHandle, jsonLogger, startDeliveryWorker } from './worker';

/** Starts delivery from process configuration. Called from `main.ts` only, never from `createApp`. */
export function startInquiryDelivery(
  db: Queryable,
  env: Readonly<Record<string, string | undefined>> = process.env,
): DeliveryWorkerHandle {
  const resolution = resolveSendConfig(env);
  return startDeliveryWorker({
    db,
    resolution,
    channel: resolution.send === null ? null : createPostmarkChannel(resolution.send),
    tuning: resolveDeliveryTuning(env),
    log: jsonLogger,
  });
}
