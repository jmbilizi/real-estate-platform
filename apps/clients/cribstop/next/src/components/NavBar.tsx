'use client';

import Link from 'next/link';
import { useApp } from '@/lib/context';
import { useEffect, useLayoutEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import CompactSearchBar from './CompactSearchBar';
import MobileSearchSheet from './MobileSearchSheet';
import MobileSearchPill from './MobileSearchPill';
import { Home, KeyRound } from 'lucide-react';
import AppsDropdown from './AppsDropdown';
import SlidePanel from './SlidePanel';
import { BRAND } from '@/lib/brand';

export default function NavBar() {
  const {
    user,
    logout,
    listingTab,
    setListingTab,
    showHeaderPill,
    headerExpanded,
    setHeaderExpanded,
    mobileSearchOpen,
    setMobileSearchOpen,
  } = useApp();
  const [profileOpen, setProfileOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();

  // Fire before the browser's first paint so the correct auth button is shown
  // on the client without ever painting the wrong one.
  useLayoutEffect(() => setMounted(true), []);

  // Collapse expanded search when ScrollSentinel scrolls back into view
  useEffect(() => {
    if (!showHeaderPill) setHeaderExpanded(false);
  }, [showHeaderPill, setHeaderExpanded]);

  // Sync data-header-expanded attribute so CSS can skip search-section transition
  useEffect(() => {
    if (headerExpanded) {
      document.documentElement.setAttribute('data-header-expanded', '');
      // Measure the expanded bar height after it renders so CSS variables
      // (.search-map-sticky, .search-results-bar) can shift below it.
      requestAnimationFrame(() => {
        const el = document.querySelector('.site-header-expanded');
        const h = el ? el.getBoundingClientRect().height : 0;
        document.documentElement.style.setProperty('--expanded-bar-h', `${h}px`);
      });
    } else {
      document.documentElement.removeAttribute('data-header-expanded');
      document.documentElement.style.setProperty('--expanded-bar-h', '0px');
    }
    window.dispatchEvent(new Event('searchbar:close'));
  }, [headerExpanded]);

  // Collapse expanded search when user scrolls down while it's open
  useEffect(() => {
    if (!headerExpanded) return;
    const startY = window.scrollY;
    const handleScroll = () => {
      if (window.scrollY > startY + 40) setHeaderExpanded(false);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [headerExpanded, setHeaderExpanded]);

  // Escape closes expanded search
  useEffect(() => {
    if (!headerExpanded) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setHeaderExpanded(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [headerExpanded, setHeaderExpanded]);

  const openModal = (mode: 'login' | 'signup') => {
    const params = new URLSearchParams(window.location.search);
    params.set('modal', mode);
    router.push(`${window.location.pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <>
      {/* Mobile full-screen search sheet */}
      {mobileSearchOpen && <MobileSearchSheet onClose={() => setMobileSearchOpen(false)} />}

      {/* Click-catcher: below SiteHeader stacking context → panels still receive clicks; page content click = close */}
      {headerExpanded && showHeaderPill && (
        <div className="fixed inset-0 z-[49]" onClick={() => setHeaderExpanded(false)} />
      )}

      <header className="relative bg-white overflow-visible">
        {/* ── Mobile full-width pill overlay (only on mobile, only when scrolled) ── */}
        {showHeaderPill && !headerExpanded && (
          <div
            className="md:hidden absolute inset-0 z-10 bg-white flex items-center px-3"
            style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)' }}
          >
            <MobileSearchPill />
          </div>
        )}
        {/* ── Logo | Tabs/Pill | Nav ── */}
        <div className="relative grid grid-cols-[auto_1fr_auto] h-16 items-center gap-2 px-3 md:px-4 lg:px-6">
          {/* Logo */}
          <Link href="/" className="flex flex-shrink-0 items-center -ml-1">
            <span className="flex items-center gap-0">
              {/* <svg
                viewBox="0 0 100 140"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="h-9 w-9 text-white"
              >
                <g>
                  <circle cx="50" cy="45" r="40" fill="#FF385C" />
                  <circle cx="50" cy="45" r="24" fill="currentColor" />
                  <line
                    x1="95"
                    y1="45"
                    x2="74"
                    y2="45"
                    stroke="currentColor"
                    strokeWidth="30"
                    strokeLinecap="round"
                  />
                  <polygon points="50,135 35,70 65,70" fill="#FF385C" />
                  <circle cx="50" cy="45" r="24" fill="currentColor" />
                  <polygon points="50,135 35,70 65,70" fill="#FF385C" />
                </g>
              </svg> */}

              {/* <span className="font-display text-lg font-bold">CRIB</span>
              <span className="font-display text-lg font-bold text-brand">STOP</span> */}

              <span className="flex flex-col">
                <span className="font-display text-xl font-bold leading-tight">
                  {BRAND.brokerage}
                </span>
                <span className="flex gap-1 mt-1">
                  <p className="font-display text-xs leading-tight">CRIB</p>
                  <p className="font-display text-xs text-brand leading-tight">STOP</p>
                </span>
              </span>
            </span>
          </Link>

          {/* ── Center: tabs / compact pill — absolutely centered on the page ── */}
          <div className="absolute left-1/2 -translate-x-1/2 w-[520px] max-w-[calc(100vw-160px)] h-16 flex items-center justify-center">
            {/* TABS — hidden by CSS when data-header-pill is set, shown again when expanded */}
            {/* Hidden on mobile (sm:hidden) — tabs appear inside MobileSearchSheet instead */}
            <div
              className="header-tabs absolute inset-0 hidden md:flex items-stretch justify-center"
              style={headerExpanded ? { opacity: 1, pointerEvents: 'auto' } : undefined}
            >
              <button
                onClick={() => setListingTab('for-sale')}
                className="group/tab relative flex items-center justify-center px-2 md:px-3 focus:outline-none"
              >
                <span
                  className={`flex items-center gap-1.5 rounded-full px-2 md:px-3 py-1.5 text-xs md:text-sm font-semibold transition-colors duration-150 ${
                    listingTab === 'for-sale'
                      ? 'text-ink'
                      : 'text-ink-muted group-hover/tab:text-ink group-hover/tab:bg-surface-soft'
                  }`}
                >
                  <Home
                    className="h-4 w-4 md:h-[18px] md:w-[18px] flex-shrink-0 text-emerald-500"
                    strokeWidth={1.75}
                  />
                  <span className="hidden xs:inline">For Sale</span>
                  <span className="xs:hidden">For Sale</span>
                </span>
                {listingTab === 'for-sale' && (
                  <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-brand rounded-full" />
                )}
              </button>

              <button
                onClick={() => setListingTab('for-rent')}
                className="group/tab relative flex items-center justify-center px-2 md:px-3 focus:outline-none"
              >
                <span
                  className={`flex items-center gap-1.5 rounded-full px-2 md:px-3 py-1.5 text-xs md:text-sm font-semibold transition-colors duration-150 ${
                    listingTab === 'for-rent'
                      ? 'text-ink'
                      : 'text-ink-muted group-hover/tab:text-ink group-hover/tab:bg-surface-soft'
                  }`}
                >
                  <KeyRound
                    className="h-4 w-4 md:h-[18px] md:w-[18px] flex-shrink-0 text-violet-500"
                    strokeWidth={1.75}
                  />
                  <span className="hidden xs:inline">For Rent</span>
                  <span className="xs:hidden">For Rent</span>
                </span>
                {listingTab === 'for-rent' && (
                  <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-brand rounded-full" />
                )}
              </button>
            </div>

            {/* COMPACT PILL — shown by CSS when data-header-pill is set on <html> */}
            <div
              className="header-pill absolute inset-0 flex items-center justify-center"
              style={headerExpanded ? { opacity: 0, pointerEvents: 'none' } : undefined}
            >
              <div className="hidden md:flex items-center justify-center w-full">
                <div className="w-full max-w-[480px]">
                  <CompactSearchBar headerMode onPillClick={() => setHeaderExpanded(true)} />
                </div>
              </div>

              {/* Mobile pill: handled by the full-width overlay above */}
              <div className="hidden" />
            </div>
          </div>
          {/* Empty grid cell placeholder for col 2 */}
          <div />

          {/* Right nav */}
          <div
            className={`relative z-20 flex items-center gap-4 ${showHeaderPill ? 'hidden md:flex' : 'flex'}`}
          >
            <Link
              href="/favorites"
              className="flex items-center justify-center rounded-full text-ink transition hover:text-brand active:text-brand"
              aria-label="Saved"
            >
              <HeartIcon className="h-5 w-5" />
            </Link>

            {/* Apps waffle — rightmost, styled like btn-primary */}
            <AppsDropdown />

            {!mounted ? (
              <div className="h-8 w-8 rounded-full bg-surface-alt" />
            ) : user ? (
              <div className="relative">
                <button
                  onClick={() => setProfileOpen((v) => !v)}
                  aria-label="Profile menu"
                  aria-expanded={profileOpen}
                  aria-haspopup="dialog"
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-brand font-semibold text-white"
                >
                  {user.name[0].toUpperCase()}
                </button>

                <SlidePanel open={profileOpen} onClose={() => setProfileOpen(false)} width={260}>
                  {/* User identity */}
                  <div className="px-5 pt-4 pb-3">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-ink font-semibold text-white text-sm">
                        {user.name[0].toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink truncate">{user.name}</p>
                        <p className="text-xs text-ink-muted truncate">{user.email}</p>
                      </div>
                    </div>
                  </div>

                  <div className="mx-4 border-t border-black/[0.06]" />

                  {/* Nav links */}
                  <div className="px-2 py-2">
                    <Link
                      href="/account"
                      className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-ink hover:bg-surface-alt transition-colors"
                      onClick={() => setProfileOpen(false)}
                    >
                      Account settings
                    </Link>
                    <Link
                      href="/favorites"
                      className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-ink hover:bg-surface-alt transition-colors"
                      onClick={() => setProfileOpen(false)}
                    >
                      Saved homes
                    </Link>
                    <Link
                      href="/alerts"
                      className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-ink hover:bg-surface-alt transition-colors"
                      onClick={() => setProfileOpen(false)}
                    >
                      Alerts
                    </Link>
                    <Link
                      href="/messages"
                      className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-ink hover:bg-surface-alt transition-colors"
                      onClick={() => setProfileOpen(false)}
                    >
                      Messages
                    </Link>
                  </div>

                  <div className="mx-4 border-t border-black/[0.06]" />

                  {/* Sign out */}
                  <div className="px-2 py-2">
                    <button
                      onClick={() => {
                        logout();
                        setProfileOpen(false);
                      }}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-ink-muted hover:bg-surface-alt transition-colors"
                    >
                      Sign out
                    </button>
                  </div>
                </SlidePanel>
              </div>
            ) : (
              <button
                onClick={() => openModal('login')}
                className="flex h-8 p-3 items-center bg-brand font-medium text-sm text-white transition hover:text-ink active:text-ink"
              >
                Sign in
              </button>
            )}
          </div>
        </div>
      </header>
    </>
  );
}

function HeartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
      />
    </svg>
  );
}
