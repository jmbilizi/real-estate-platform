import { NextResponse } from 'next/server';
import { gatewayBaseUrl } from '../../_lib/gateway';

export const dynamic = 'force-dynamic';

const GATEWAY_READY_TIMEOUT_MS = 2_000;

/**
 * Readiness probe (#954): the pod is ready only when it reaches the gateway. A pod that cannot
 * reach the gateway leaves the Service endpoints instead of serving pages with no data.
 * Liveness stays on the static `/api/health`, so a gateway outage never restarts pods.
 */
export async function GET() {
  try {
    const response = await fetch(`${gatewayBaseUrl()}/health/ready`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(GATEWAY_READY_TIMEOUT_MS),
    });
    if (response.ok) return NextResponse.json({ status: 'ready' }, { status: 200 });
    return NextResponse.json({ status: 'gateway-not-ready' }, { status: 503 });
  } catch {
    return NextResponse.json({ status: 'gateway-unreachable' }, { status: 503 });
  }
}
