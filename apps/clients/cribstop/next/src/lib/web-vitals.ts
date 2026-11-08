import { WEB_VITAL_METRICS } from '@cribstop/property-contracts';
import { pathTemplate, surfaceFromPath, trackEvent } from './analytics';

/** The fields of a `useReportWebVitals` metric that this module reads. */
export interface WebVitalMetric {
  name: string;
  value: number;
  rating?: string;
}

const RATINGS = ['good', 'needs-improvement', 'poor'] as const;
type VitalName = (typeof WEB_VITAL_METRICS)[number];

/**
 * Sends one `web_vital` event for LCP, INP or CLS (#987). Any other metric is ignored.
 *
 * `landingPath` is the path the page loaded on. A vital describes that page load, even when it
 * finalizes after a client navigation. The event carries the route template and never the URL, a
 * listing id or a query string. `trackEvent` applies the anon id, opt-out and Global Privacy
 * Control rules, so a visitor who opted out sends nothing.
 */
export function reportWebVital(metric: WebVitalMetric, landingPath: string): void {
  if (!(WEB_VITAL_METRICS as readonly string[]).includes(metric.name)) return;
  if (!Number.isFinite(metric.value) || metric.value < 0) return;
  const rating = RATINGS.find((r) => r === metric.rating);
  if (!rating) return;
  const name = metric.name as VitalName;
  trackEvent('web_vital', {
    surface: surfaceFromPath(landingPath),
    props: {
      path_template: pathTemplate(landingPath),
      metric: name,
      // LCP and INP are whole milliseconds. CLS is a score with 4 decimals.
      value: name === 'CLS' ? Math.round(metric.value * 10_000) / 10_000 : Math.round(metric.value),
      rating,
    },
  });
}
