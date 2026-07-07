'use client';

import { useApp } from '@/lib/context';
import NavBar from './NavBar';
import CompactSearchBar from './CompactSearchBar';

/**
 * SiteHeader — sticky 64px header.
 *
 * The full search bar lives in the page content (ScrollSentinel) so it scrolls
 * away naturally. The expanded bar below is shown when the user clicks the
 * compact pill while scrolled.
 */
export default function SiteHeader() {
  const { setHeaderExpanded } = useApp();

  return (
    <div className="site-header-wrapper sticky top-0 z-50 bg-white overflow-visible">
      <NavBar />

      {/* Expanded search: shown when user clicks compact pill while scrolled */}
      <div className="site-header-expanded">
        <div className="site-header-expanded-inner">
          <CompactSearchBar onDone={() => setHeaderExpanded(false)} />
        </div>
      </div>
    </div>
  );
}
