import { Suspense } from 'react';
import SearchExperience from '@/components/SearchExperience';

/**
 * The search route.
 *
 * The experience itself lives in `components/SearchExperience` because the standalone listing page
 * renders it too, as the backdrop behind the detail modal — and a route file should not be imported
 * from another route. With no `query` prop it reads the browser URL, which is what makes this URL
 * the shareable source of truth for a result set.
 */
export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-24 text-ink-muted">Loading search…</div>
      }
    >
      <SearchExperience />
    </Suspense>
  );
}
