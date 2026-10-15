import {
  type HomeFeedRequest,
  type HomeFeedResponse,
  homeFeedResponseSchema,
} from '@cribstop/property-contracts';

/**
 * Reads the personalised home feed through this app's relay (#836). Any failure throws. The
 * caller then shows today's rows, so a failed feed never shows an error to the visitor.
 */
export async function getHomeFeed(
  request: HomeFeedRequest,
  signal?: AbortSignal,
): Promise<HomeFeedResponse> {
  const res = await fetch('/api/home-feed', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error(`home feed ${res.status}`);
  const parsed = homeFeedResponseSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new Error('home feed shape');
  return parsed.data;
}
