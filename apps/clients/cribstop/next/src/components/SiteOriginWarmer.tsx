'use client';

import { useEffect } from 'react';
import { warmSiteOrigin } from '@/lib/site-origin';

/** Loads the server's `SITE_ORIGIN` once so share links match the canonical link (#172). */
export default function SiteOriginWarmer() {
  useEffect(() => {
    void warmSiteOrigin();
  }, []);
  return null;
}
