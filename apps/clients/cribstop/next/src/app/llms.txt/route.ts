import { publishableOrigin } from '@/lib/publishable-origin';
import { llmsTxtFor } from '@/lib/site-indexing';

export const dynamic = 'force-dynamic';

/** Non-production origins answer 404, like `/sitemap-index.xml`. */
export function GET() {
  const body = llmsTxtFor(publishableOrigin());
  if (body === null) return new Response('Not found', { status: 404 });
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
