'use client';

import { useEffect, useRef } from 'react';
import { useApp } from '@/lib/context';
import CompactSearchBar from './CompactSearchBar';
import MobileSearchPill from './MobileSearchPill';

// Hysteresis buffer (px) below the swap threshold, applied on the way BACK only.
// Trackpad scrolling decelerates smoothly and can settle with the scroll position
// hovering right at the threshold — without a buffer the hard-step swap would
// flicker on/off every frame as it drifts a fraction of a pixel either way. Once
// the pill is showing, the scroll therefore has to come back this far below the
// threshold before it gives up the pill, so it latches instead of chattering.
//
// Deliberately NOT applied on the way in. A buffer there is scroll distance the
// user spends watching the in-page bar slide toward the header tabs before
// anything starts animating — it was 8px, and with the threshold on the home page
// sitting at 0 that meant the swap couldn't fire until the tabs-to-bar gap had
// already closed from 17px to 13px. The shrink should begin from the bar's resting
// position, on the first pixel of scroll.
const SWAP_HYSTERESIS_PX = 8;

/**
 * ScrollSentinel — scroll position detector + page-level search bar host.
 *
 * Used on every page. Two modes:
 *
 * Default (`alwaysPill` omitted):
 *   Renders CompactSearchBar (the single, always-mounted instance — see that
 *   file's own comment) inside the in-page row + the mobile pill. The instant
 *   the scroll position crosses the threshold (search bar about to go behind
 *   the sticky header), sets `data-header-pill` on <html>, which CompactSearchBar
 *   reads via context to switch itself from its in-page layout to a
 *   position:fixed pill docked in the header — a hard cut, not a
 *   scroll-distance-proportional fade. (Matches how real search UIs like Airbnb's
 *   behave: the swap is immediate, not an animation tied to how far you've scrolled —
 *   driving it continuously off scroll position just fights the browser's own scroll
 *   anchoring and reads as laggy/stuck instead of responsive.)
 *
 * `alwaysPill` mode (listing detail, etc.):
 *   Activates `data-header-pill` immediately on mount (no search bar in page flow).
 *   Pill stays active for the full page lifetime — no scroll detection needed.
 *   Same CSS/state path as the scroll-based mode.
 */
export default function ScrollSentinel({ alwaysPill = false }: { alwaysPill?: boolean }) {
  const { setShowHeaderPill } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const pillRef = useRef(false);

  useEffect(() => {
    if (alwaysPill) {
      // Immediately lock into pill mode for the lifetime of this page
      document.documentElement.setAttribute('data-header-pill', '');
      setShowHeaderPill(true);
      pillRef.current = true;
      return () => {
        document.documentElement.removeAttribute('data-header-pill');
        setShowHeaderPill(false);
      };
    }

    // Scroll-based mode — set initial state
    document.documentElement.removeAttribute('data-header-pill');
    setShowHeaderPill(false);
    pillRef.current = false;

    // Scroll position at which the section should swap to the pill. Only recomputed
    // while at rest (not pill-active), since the pill state hides this section and
    // would throw off the measurement.
    let threshold = 0;

    const measureLayout = () => {
      if (pillRef.current) return;
      const headerEl = document.querySelector('header');
      const headerH = headerEl?.getBoundingClientRect().height ?? 64;
      const rect = ref.current?.getBoundingClientRect();
      if (rect) threshold = rect.top + window.scrollY - headerH;
    };

    measureLayout();

    let rafId: number | null = null;

    const apply = () => {
      rafId = null;
      // Clamped at 0: the search bar sits close enough to the header that threshold
      // can be smaller than the hysteresis buffer itself. Without the clamp, the
      // "turn off" edge would fall below scrollY's hard floor of 0 and the pill could
      // never turn back off once triggered, even scrolled all the way back to rest.
      const offEdge = Math.max(threshold - SWAP_HYSTERESIS_PX, 0);
      const shouldShow = pillRef.current ? window.scrollY > offEdge : window.scrollY > threshold;
      if (shouldShow === pillRef.current) return;

      if (shouldShow) {
        document.documentElement.setAttribute('data-header-pill', '');
        // Close any open field panel — it belongs to the 'large' layout,
        // which is about to stop rendering in favor of the pill button.
        window.dispatchEvent(new Event('searchbar:close'));
      } else {
        document.documentElement.removeAttribute('data-header-pill');
        document.documentElement.removeAttribute('data-header-expanded');
      }

      pillRef.current = shouldShow;
      setShowHeaderPill(shouldShow);
    };

    // Coalesce scroll/resize bursts to one measurement per frame
    const check = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(apply);
    };

    const onResize = () => {
      measureLayout();
      check();
    };

    check();
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', check);
      window.removeEventListener('resize', onResize);
      document.documentElement.removeAttribute('data-header-pill');
      setShowHeaderPill(false);
    };
  }, [alwaysPill, setShowHeaderPill]);

  // alwaysPill pages have no in-page row at all — CompactSearchBar renders
  // directly and resolves straight to its fixed pill layout (showHeaderPill is
  // forced true above), no wrapper/collapse machinery needed. Passed through
  // so clicking a field in the pill knows there's no 'large' layout to grow
  // back into and opens the 'expanded' overlay instead.
  if (alwaysPill) {
    return <CompactSearchBar alwaysPill />;
  }

  return (
    <div ref={ref} className="search-section w-full relative">
      {/* Desktop: CompactSearchBar renders in normal page flow here when not
          scrolled; once scrolled past the threshold it switches itself to
          position:fixed (docked in the header) via context, so this wrapper's
          own height needs to collapse in sync or page content below would jump
          instead of sliding up smoothly. */}
      <div className="desktop-search-bar-wrapper relative hidden md:block bg-white">
        <CompactSearchBar />
      </div>

      {/* Mobile only: search pill */}
      <div className="mobile-search-pill-row md:hidden px-4 py-3 bg-white flex">
        <MobileSearchPill />
      </div>
      {/* Gradient fade divider */}
      <div
        className="h-3 pointer-events-none"
        style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.07), transparent)' }}
      />
    </div>
  );
}
