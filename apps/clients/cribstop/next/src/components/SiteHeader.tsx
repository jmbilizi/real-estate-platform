'use client';

import { useApp } from '@/lib/context';
import NavBar from './NavBar';
import CompactSearchBar from './CompactSearchBar';

/**
 * SiteHeader — always 65 px tall (NavBar only).
 *
 * The full search bar lives in the page content (HomePageContent) so it scrolls
 * away naturally — zero layout jump on scroll.
 *
 * The expanded bar below is only shown when the user explicitly clicks the compact
 * pill (data-header-pill + data-header-expanded), so its height change is intentional.
 */
export default function SiteHeader() {
  const { setHeaderExpanded } = useApp();

  return (
    <div className="site-header-wrapper sticky top-0 z-50 bg-white overflow-visible">
      <NavBar />

      {/* Expanded search: slides down when user clicks compact pill while scrolled */}
      <div className="site-header-expanded">
        <div className="search-bar-slide-down">
          <CompactSearchBar onDone={() => setHeaderExpanded(false)} />
        </div>
      </div>
    </div>
  );
}
