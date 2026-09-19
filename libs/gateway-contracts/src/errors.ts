import { z } from 'zod';

/**
 * The error codes the API gateway itself emits, never a downstream service.
 *
 * `upstream_unavailable` (502/503) comes from `UpstreamUnavailableMiddleware` when a downstream
 * timed out, its circuit breaker is open, or its connection never opened. `rate_limited` (429)
 * comes from Ocelot's own rate limiter. Both fire on every route — property, account and
 * inference alike — before the request reaches a service, which is why this contract does not
 * live in `@cribstop/property-contracts`: that package's schemas describe what one service
 * promises, and a gateway-enforced response is not that service's claim to make.
 *
 * See `apps/api-gateway/AGENTS.md` → "Quality of Service" for the status/code mapping this
 * mirrors, and `apps/api-gateway/Middleware/` for the C# source of truth.
 */
export const GATEWAY_ERROR_CODES = ['upstream_unavailable', 'rate_limited'] as const;

export const gatewayErrorBodySchema = z.object({
  error: z.object({
    code: z.enum(GATEWAY_ERROR_CODES),
    message: z.string(),
  }),
});

export type GatewayErrorCode = (typeof GATEWAY_ERROR_CODES)[number];
export type GatewayErrorBody = z.infer<typeof gatewayErrorBodySchema>;

/**
 * Narrows an unknown response body to the gateway's own error shape.
 *
 * A caller uses this to tell "the gateway itself failed" apart from a downstream service's own
 * error body, which carries a different `error.code` set (or, for account and inference, a
 * different shape entirely — see the package README).
 */
export function isGatewayErrorBody(body: unknown): body is GatewayErrorBody {
  return gatewayErrorBodySchema.safeParse(body).success;
}

/**
 * The HTTP statuses the gateway pairs with each code, for documentation and tests only — no
 * runtime behaviour reads this map. Ocelot chooses 503 for a timeout or an open breaker and 502
 * for a connection that never opened; both are `upstream_unavailable`.
 */
export const GATEWAY_ERROR_STATUS: Record<GatewayErrorCode, readonly number[]> = {
  upstream_unavailable: [502, 503],
  rate_limited: [429],
};
