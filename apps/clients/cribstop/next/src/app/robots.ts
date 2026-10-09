import type { MetadataRoute } from 'next';
import { publishableOrigin } from '@/lib/publishable-origin';
import { robotsFor } from '@/lib/site-indexing';

// `SITE_ORIGIN` is read per request: one image serves every environment.
export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  return robotsFor(publishableOrigin());
}
