'use client';

import { useEffect } from 'react';
import { useApp } from '@/lib/context';
import CompactSearchBar from './CompactSearchBar';

/**
 * Mounts the one `CompactSearchBar`, docked as the header pill, on every page.
 *
 * The search bar has one resting place at every width: the pill in the header. A click on it opens
 * the expanded bar under the header (the full-screen sheet on a phone). There is no in-page search
 * row and no scroll threshold, so nothing in the header moves or changes size on scroll.
 *
 * The name is historical: this component used to watch the scroll position and swap an in-page
 * bar for the pill. `data-header-pill` stays on `<html>` for the CSS that reads it.
 */
export default function ScrollSentinel() {
  const { setShowHeaderPill } = useApp();

  useEffect(() => {
    document.documentElement.setAttribute('data-header-pill', '');
    setShowHeaderPill(true);
    return () => {
      document.documentElement.removeAttribute('data-header-pill');
      document.documentElement.removeAttribute('data-header-expanded');
      setShowHeaderPill(false);
    };
  }, [setShowHeaderPill]);

  return <CompactSearchBar alwaysPill />;
}
