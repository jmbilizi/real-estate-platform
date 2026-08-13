import { proxyListingsRead } from '@/app/api/_lib/listings-gateway';

/**
 * Dataset freshness, deliberately independent of any search: the footer renders on every route,
 * including routes that never search, so it cannot be fed from a paginated search response.
 */
export async function GET() {
  return proxyListingsRead('/meta');
}
