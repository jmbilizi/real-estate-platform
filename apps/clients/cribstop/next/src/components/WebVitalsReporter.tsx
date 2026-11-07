'use client';

import { useRef } from 'react';
import { useReportWebVitals } from 'next/web-vitals';
import { reportWebVital } from '@/lib/web-vitals';

/** Reports LCP, INP and CLS through the first-party event route (#987). Renders nothing. */
export default function WebVitalsReporter() {
  // Read once, on the first render of the page load. A later client navigation does not change it.
  const landingPath = useRef<string | null>(null);
  if (landingPath.current === null && typeof window !== 'undefined') {
    landingPath.current = window.location.pathname;
  }
  useReportWebVitals((metric) => {
    reportWebVital(metric, landingPath.current ?? window.location.pathname);
  });
  return null;
}
