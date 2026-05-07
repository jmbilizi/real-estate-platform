'use client';

import Link from 'next/link';
import { useApp } from '@/lib/context';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import CompactSearchBar from './CompactSearchBar';
import MobileSearchSheet from './MobileSearchSheet';
import { Home, KeyRound } from 'lucide-react';

export default function Header() {
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const router = useRouter();

  // Collapse expanded search when SearchSection scrolls back into view
  useEffect(() => {
    if (!showHeaderPill) setHeaderExpanded(false);
  }, [showHeaderPill, setHeaderExpanded]);

  // Sync data-header-expanded attribute so CSS can skip search-section transition
  useEffect(() => {
    if (headerExpanded) {
      document.documentElement.setAttribute('data-header-expanded', '');
    } else {
      document.documentElement.removeAttribute('data-header-expanded');
    }
    window.dispatchEvent(new Event('searchbar:close'));
  }, [headerExpanded]);

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
    router.push(`${window.location.pathname}?${params.toString()}`);
  };

  const showBorder = showHeaderPill && !headerExpanded;

  return (
    <>
      {/* Mobile full-screen search sheet */}
      {mobileSearchOpen && <MobileSearchSheet onClose={() => setMobileSearchOpen(false)} />}

      {/* Click-catcher at z-[49]: below header stacking context (z-50) → panels still receive clicks; page content click = close */}
      {headerExpanded && showHeaderPill && (
        <div className="fixed inset-0 z-[49]" onClick={() => setHeaderExpanded(false)} />
      )}

      <header
        className={`sticky top-0 z-50 bg-white overflow-visible transition-[border-color,box-shadow] duration-200 ${
          showBorder
            ? 'border-b border-[rgba(0,0,0,0.08)] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_2px_8px_rgba(0,0,0,0.04)]'
            : 'border-b border-transparent shadow-none'
        }`}
      >
        {/* â”€â”€ Row 1: Logo | Tabs/Pill | Nav â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <div className="relative grid grid-cols-[auto_1fr_auto] h-16 items-center gap-2 px-3 sm:px-4 lg:px-6">
          {/* Logo */}
          <Link href="/" className="flex flex-shrink-0 items-center -ml-1">
            <span className="flex items-center gap-0">
              <svg
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
              </svg>
              <span className="font-display text-lg font-bold">CRIB</span>
              <span className="font-display text-lg font-bold text-brand">STOP</span>
            </span>
          </Link>

          {/* ── Center: tabs / compact pill — absolutely centered on the page ── */}
          <div className="absolute left-1/2 -translate-x-1/2 w-[520px] max-w-[calc(100vw-160px)] h-16 flex items-center justify-center">
            {/* TABS — hidden by CSS when data-header-pill is set, shown again when expanded */}
            <div
              className="header-tabs absolute inset-0 flex items-stretch justify-center"
              style={headerExpanded ? { opacity: 1, pointerEvents: 'auto' } : undefined}
            >
              <button
                onClick={() => setListingTab('for-sale')}
                className="group/tab relative flex items-center justify-center px-2 sm:px-3 focus:outline-none"
              >
                <span
                  className={`flex items-center gap-1.5 rounded-full px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-semibold transition-colors duration-150 ${
                    listingTab === 'for-sale'
                      ? 'text-ink'
                      : 'text-ink-muted group-hover/tab:text-ink group-hover/tab:bg-surface-soft'
                  }`}
                >
                  <Home
                    className="h-4 w-4 sm:h-[18px] sm:w-[18px] flex-shrink-0 text-emerald-500"
                    strokeWidth={1.75}
                  />
                  <span className="hidden xs:inline">For Sale</span>
                  <span className="xs:hidden">Buy</span>
                </span>
                {listingTab === 'for-sale' && (
                  <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-brand rounded-full" />
                )}
              </button>

              <button
                onClick={() => setListingTab('for-rent')}
                className="group/tab relative flex items-center justify-center px-2 sm:px-3 focus:outline-none"
              >
                <span
                  className={`flex items-center gap-1.5 rounded-full px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-semibold transition-colors duration-150 ${
                    listingTab === 'for-rent'
                      ? 'text-ink'
                      : 'text-ink-muted group-hover/tab:text-ink group-hover/tab:bg-surface-soft'
                  }`}
                >
                  <KeyRound
                    className="h-4 w-4 sm:h-[18px] sm:w-[18px] flex-shrink-0 text-violet-500"
                    strokeWidth={1.75}
                  />
                  <span className="hidden xs:inline">For Rent</span>
                  <span className="xs:hidden">Rent</span>
                </span>
                {listingTab === 'for-rent' && (
                  <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-brand rounded-full" />
                )}
              </button>
            </div>

            {/* COMPACT PILL — shown by CSS when data-header-pill is set on <html> */}
            <div
              className="header-pill absolute inset-0 flex items-center justify-center transition-opacity duration-150"
              style={headerExpanded ? { opacity: 0, pointerEvents: 'none' } : undefined}
            >
              <div className="hidden sm:flex items-center justify-center w-full">
                <div className="w-full max-w-[480px]">
                  <CompactSearchBar headerMode onPillClick={() => setHeaderExpanded(true)} />
                </div>
              </div>

              {/* Mobile: simplified 2-line pill */}
              <button
                onClick={() => setMobileSearchOpen(true)}
                aria-label="Search"
                className="sm:hidden flex items-center gap-3 rounded-full border border-[rgba(0,0,0,0.08)] bg-white px-3 py-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.08),0_2px_8px_rgba(0,0,0,0.05)] hover:shadow-[0_2px_4px_rgba(0,0,0,0.08),0_6px_14px_rgba(0,0,0,0.08)] transition-shadow"
              >
                <div className="flex flex-col items-start min-w-0 flex-1">
                  <span className="text-[13px] font-semibold text-ink leading-tight">
                    Search homes
                  </span>
                  <span className="text-[11px] text-ink-muted leading-tight truncate max-w-[140px]">
                    Anywhere · Anytime
                  </span>
                </div>
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-brand text-white">
                  <svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.5}
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                </span>
              </button>
            </div>
          </div>
          {/* Empty grid cell placeholder for col 2 */}
          <div />

          {/* Right nav */}
          <div className="flex items-center gap-1 sm:gap-2">
            <Link
              href="/favorites"
              className="hidden h-10 w-10 items-center justify-center rounded-full text-ink-muted transition hover:bg-surface-alt hover:text-ink md:flex"
              aria-label="Saved"
            >
              <HeartIcon className="h-5 w-5" />
            </Link>

            {user ? (
              <div className="relative">
                <button
                  onClick={() => setProfileOpen(!profileOpen)}
                  className="flex h-10 items-center gap-2 rounded-full border border-surface-border bg-white pl-3 pr-1 transition hover:shadow-card"
                >
                  <svg
                    className="h-4 w-4 text-ink-muted"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 6h16M4 12h16M4 18h16"
                    />
                  </svg>
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink font-semibold text-white">
                    {user.name[0]}
                  </span>
                </button>
                {profileOpen && (
                  <div className="absolute right-0 top-12 z-50 w-56 rounded-2xl border border-surface-border bg-white p-2 shadow-pop">
                    <p className="px-3 py-2 text-sm font-semibold">{user.name}</p>
                    <p className="px-3 pb-2 text-xs text-ink-muted">{user.email}</p>
                    <hr className="my-1 border-surface-border" />
                    <Link
                      href="/favorites"
                      className="block rounded-lg px-3 py-2 text-sm hover:bg-surface-alt"
                      onClick={() => setProfileOpen(false)}
                    >
                      Saved Homes
                    </Link>
                    <button
                      onClick={() => {
                        logout();
                        setProfileOpen(false);
                      }}
                      className="block w-full rounded-lg px-3 py-2 text-left text-sm text-ink-muted hover:bg-surface-alt"
                    >
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <button
                  onClick={() => openModal('login')}
                  className="hidden rounded-full px-4 py-2 text-sm font-medium text-ink transition hover:bg-surface-alt sm:inline-flex"
                >
                  Sign in
                </button>
                <button
                  onClick={() => openModal('signup')}
                  className="hidden sm:inline-flex btn-primary"
                >
                  Sign up
                </button>
              </>
            )}

            {/* Hamburger (mobile) */}
            <button
              className="flex h-10 w-10 items-center justify-center rounded-full text-ink-muted hover:bg-surface-alt"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="Menu"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {menuOpen ? (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                ) : (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 8h16M4 16h16"
                  />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* ── Row 2: absolutely positioned so header height never changes (no layout shift) ── */}
        {showHeaderPill && headerExpanded && (
          <div className="search-bar-slide-down absolute top-[calc(100%_+_1px)] left-0 right-0 z-50 bg-white border-b border-surface-border overflow-visible">
            <CompactSearchBar onDone={() => setHeaderExpanded(false)} />
          </div>
        )}

        {/* Mobile menu drawer */}
        {menuOpen && (
          <nav className="border-t border-surface-border bg-white px-4 py-4">
            <div className="flex flex-col gap-3 text-sm font-medium">
              <Link href="/search?listingType=sale" onClick={() => setMenuOpen(false)}>
                Buy
              </Link>
              <Link href="/search?listingType=rent" onClick={() => setMenuOpen(false)}>
                Rent
              </Link>
              <Link href="/favorites" onClick={() => setMenuOpen(false)}>
                Saved Homes
              </Link>
              {!user && (
                <button
                  onClick={() => {
                    openModal('login');
                    setMenuOpen(false);
                  }}
                >
                  Sign In
                </button>
              )}
            </div>
          </nav>
        )}
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
