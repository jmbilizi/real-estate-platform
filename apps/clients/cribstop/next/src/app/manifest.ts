import type { MetadataRoute } from 'next';
import { BRAND } from '@/lib/brand';

/**
 * Lets "Add to Home Screen" open the site full screen (#923). The name keeps the brokerage first,
 * as the brand rule requires. No icons are listed: the repo has no icon assets yet.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${BRAND.brokerage} · ${BRAND.siteName}`,
    short_name: BRAND.siteName,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
  };
}
