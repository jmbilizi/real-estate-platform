'use client';

import Link from 'next/link';
import { useApp } from '@/lib/context';
import { useEffect, useLayoutEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useRouter } from 'nextjs-toploader/app';
import { motion } from 'motion/react';
import { Bell, Heart, LogOut, MessageCircle, UserPlus } from 'lucide-react';
import MobileSearchSheet from './MobileSearchSheet';
import MobileSearchPill from './MobileSearchPill';
import AppsDropdown from './AppsDropdown';
import SlidePanel from './SlidePanel';
import DismissButton from './DismissButton';
import { BRAND } from '@/lib/brand';
import { getUserDisplayName, getUserInitials } from '@/lib/store/types';
import { NAV_TABS } from './NavTabIcons';
import { SkeletonBar, SkeletonBlock } from './Skeleton';

/**
 * Placeholder widths for each tab label, so a skeletoned tab row is the same width as the loaded
 * one and the tabs do not shuffle sideways when the labels arrive. Keyed by tab id rather than
 * measured, because the labels are fixed copy.
 */
const TAB_LABEL_WIDTH: Record<string, string> = {
  homes: 'w-14',
  services: 'w-16',
  connect: 'w-16',
};

export default function NavBar() {
  const {
    user,
    logout,
    activeTab,
    setActiveTab,
    showHeaderPill,
    headerExpanded,
    setHeaderExpanded,
    mobileSearchOpen,
    setMobileSearchOpen,
  } = useApp();
  const [profileOpen, setProfileOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  // SSR guard — fires synchronously before paint on the client
  const [hydrated, setHydrated] = useState(false);
  useLayoutEffect(() => {
    setHydrated(true);
  }, []);

  /**
   * Which tab the *route* says we are on — derived during render, not in an effect.
   *
   * The store's `activeTab` starts at its slice default and only learns the route when the effect
   * below runs, which is to say: never on the server. So a direct load of `/services` shipped HTML
   * with the underline sitting under **Homes**, and it jumped across the header once the bundle
   * hydrated. That is the one flavour of pre-hydration gap a placeholder cannot help with — the
   * markup was not blank, it was confidently wrong, and the answer was in the URL the whole time.
   */
  const tabFromPath = pathname.startsWith('/services')
    ? 'services'
    : pathname.startsWith('/connect')
      ? 'connect'
      : 'homes';

  /*
   * Before hydration, trust the route; after, trust the store.
   *
   * It is not simply always `tabFromPath`, because tapping a tab sets `activeTab` and *then*
   * navigates — so for the duration of that navigation the store is ahead of the pathname, and
   * rendering off the path alone would leave the underline behind until the route caught up.
   */
  const displayTab = hydrated ? activeTab : tabFromPath;

  // Keep the store in step with the route for everything else that reads `activeTab`.
  useEffect(() => {
    setActiveTab(tabFromPath);
    setHeaderExpanded(false);
  }, [tabFromPath, setActiveTab, setHeaderExpanded]);

  // Collapse expanded search when ScrollSentinel scrolls back into view
  useEffect(() => {
    if (!showHeaderPill) setHeaderExpanded(false);
  }, [showHeaderPill, setHeaderExpanded]);

  // Sync data-header-expanded attribute
  useEffect(() => {
    if (headerExpanded) {
      document.documentElement.setAttribute('data-header-expanded', '');
      requestAnimationFrame(() => {
        const el = document.querySelector('[data-search-bar-dock="expanded"]');
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

      {/* Click-catcher backdrop */}
      {headerExpanded && showHeaderPill && (
        <div className="fixed inset-0 z-nav-backdrop" onClick={() => setHeaderExpanded(false)} />
      )}

      <header className="relative bg-white overflow-visible">
        {/* ── Mobile full-width pill overlay (only on mobile, only when scrolled) ── */}
        {showHeaderPill && !headerExpanded && (
          <div
            className="md:hidden absolute inset-0 z-10 bg-white flex items-center px-3"
            style={{
              boxShadow:
                'rgba(0, 0, 0, 0.02) 0 0 0 1px, rgba(0, 0, 0, 0.04) 0 2px 6px 0, rgba(0, 0, 0, 0.1) 0 4px 8px 0',
            }}
          >
            <MobileSearchPill />
          </div>
        )}

        {/* ── Logo | Tabs/Pill | Nav ── */}
        <div className="relative grid grid-cols-[auto_1fr_auto] h-16 items-center gap-2 px-3 md:px-4 lg:px-6">
          {/*
           * Logo — brand name and wordmark render unconditionally, never behind the `hydrated`
           * gate. Both are compile-time constants (`BRAND.brokerage`, "CRIB"/"STOP"), so there is
           * no hydration uncertainty to placeholder over, and PRD §6.1 requires Real Broker, LLC
           * to read from the server-rendered HTML at its most prominent placement.
           */}
          <Link href="/" className="flex flex-shrink-0 items-center -ml-1">
            <span className="flex items-center gap-0">
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

          {/* ── Center: tabs / compact pill ── */}
          <div className="absolute left-1/2 -translate-x-1/2 w-[520px] max-w-[calc(100vw-160px)] h-16 flex items-center justify-center">
            {/* TABS — visible when NOT scrolled, or when expanded */}
            <div
              className="header-tabs absolute inset-0 hidden md:flex items-stretch justify-center"
              style={
                headerExpanded
                  ? { opacity: 1, pointerEvents: 'auto', transform: 'translateY(0) scale(1)' }
                  : undefined
              }
            >
              <div className="relative flex items-center gap-8">
                {NAV_TABS.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = displayTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => {
                        setActiveTab(tab.id);
                        if (tab.id === 'services') router.push('/services');
                        else if (tab.id === 'connect') router.push('/connect');
                        else if (tab.id === 'homes') router.push('/');
                      }}
                      className="group/tab relative flex items-center justify-center h-full focus:outline-none"
                    >
                      <span
                        className={`flex items-center gap-1 transition-colors duration-150 ${
                          isActive ? 'text-ink' : 'text-ink-muted group-hover/tab:text-ink'
                        }`}
                      >
                        {hydrated ? (
                          <span className="content-resolved flex items-center gap-1">
                            <Icon className={`${tab.iconClass} block flex-shrink-0`} />
                            <span className="text-[15px] font-semibold">{tab.label}</span>
                          </span>
                        ) : (
                          <>
                            {/* The icon's own box, so the tab keeps its width and the row does
                                not reflow when the labels arrive. */}
                            <SkeletonBlock className={`${tab.iconClass} rounded-xs`} />
                            <span className="text-[15px] font-semibold">
                              <SkeletonBar className={TAB_LABEL_WIDTH[tab.id] ?? 'w-16'} />
                            </span>
                          </>
                        )}
                      </span>
                      {/*
                       * Animated underline — pinned to bottom of header.
                       *
                       * Not gated on `hydrated`: `isActive` already resolves from the route
                       * before hydration (`displayTab`), so the server ships the underline under
                       * the correct tab from first paint, not only after the bundle runs.
                       */}
                      {isActive && (
                        <motion.span
                          layoutId="nav-tab-underline"
                          className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full bg-brand"
                          transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* The compact pill itself is CompactSearchBar rendered from
                ScrollSentinel — it docks here via position:fixed (see its own
                DOCK_STYLE) rather than being a child of this tree, since it
                needs to be able to also render in normal page flow further
                down the page. This slot just hosts the tabs above. */}
          </div>
          {/* Empty grid cell placeholder for col 2 */}
          <div />

          {/* Right nav */}
          <div
            className={`relative z-20 flex items-center gap-4 ${showHeaderPill ? 'hidden md:flex' : 'flex'}`}
          >
            {/*
             * Saved and Apps are identical whether or not anyone is signed in, so they render
             * straight away. They used to sit behind the `hydrated` gate below, which hid three
             * controls because one of them was uncertain — and left the whole right-hand nav blank
             * from first paint until the bundle finished hydrating.
             */}
            <Link
              href="/favorites"
              className="flex items-center justify-center rounded-full text-ink transition hover:text-brand active:text-brand"
              aria-label="Saved"
            >
              {hydrated ? (
                <HeartIcon className="h-5 w-5 content-resolved" />
              ) : (
                <SkeletonBlock className="h-5 w-5 rounded-xs" />
              )}
            </Link>

            {hydrated ? (
              <span className="content-resolved flex items-center">
                <AppsDropdown />
              </span>
            ) : (
              <SkeletonBlock className="h-5 w-5 rounded-xs" />
            )}

            {/*
             * The one genuinely unknown slot, and the reason for the gate.
             *
             * `auth` is the only slice restored from localStorage (`store/store.ts`), so the server
             * renders with `user: null` while a returning visitor's client store already has them.
             * Rendering the real answer on the first client pass would be a hydration mismatch, so
             * both sides render the placeholder and it resolves in a `useLayoutEffect`.
             *
             * That window is not the single frame it looks like. `hydrated` flips one frame after
             * *hydration*, but the gap a visitor actually sees is first paint → hydration: the
             * server HTML paints, then the bundle has to arrive, parse and run. On a cold load
             * that is seconds, and it is exactly the window this placeholder occupies.
             *
             * `min-w` holds the slot at the width of the wider outcome so the nav's total width
             * never changes and Saved/Apps cannot slide sideways on hydration. Its value is the
             * Sign-in button's; if that button's copy or padding changes, this changes with it.
             */}
            <div className={`flex min-w-[72px] justify-end ${hydrated ? 'content-resolved' : ''}`}>
              {!hydrated ? (
                <NavAuthSkeleton />
              ) : user ? (
                <div className="relative">
                  <button
                    onClick={() => setProfileOpen((v) => !v)}
                    aria-label="Profile menu"
                    aria-expanded={profileOpen}
                    aria-haspopup="dialog"
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-brand font-semibold text-white"
                  >
                    {getUserInitials(user)}
                  </button>

                  <SlidePanel open={profileOpen} onClose={() => setProfileOpen(false)} width={314}>
                    <div className="absolute right-2 top-2">
                      <DismissButton onClick={() => setProfileOpen(false)} />
                    </div>

                    {/* Avatar + name + email */}
                    <div className="flex flex-col items-center px-5 pt-6 pb-4 gap-2">
                      <span className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full bg-brand font-bold text-white text-xl">
                        {getUserInitials(user)}
                      </span>
                      <div className="text-center min-w-0 w-full">
                        <p className="text-sm font-semibold text-ink truncate">
                          {getUserDisplayName(user)}
                        </p>
                        {getUserDisplayName(user) !== user.email && (
                          <p className="text-xs text-ink-muted truncate">{user.email}</p>
                        )}
                      </div>
                      <Link
                        href="/account"
                        onClick={() => setProfileOpen(false)}
                        className="rounded-full border border-surface-border px-4 py-1.5 text-xs font-medium text-ink hover:bg-gray-100 transition-colors"
                      >
                        Manage your Account
                      </Link>
                    </div>

                    <div className="border-t border-black/[0.06]" />

                    <div className="">
                      <Link
                        href="/favorites"
                        className="flex items-center gap-3 px-5 py-2.5 text-sm text-ink hover:bg-gray-100 transition-colors"
                        onClick={() => setProfileOpen(false)}
                      >
                        <Heart className="h-4 w-4 shrink-0 text-ink-muted" />
                        Saved homes
                      </Link>
                      <Link
                        href="/alerts"
                        className="flex items-center gap-3 px-5 py-2.5 text-sm text-ink hover:bg-gray-100 transition-colors"
                        onClick={() => setProfileOpen(false)}
                      >
                        <Bell className="h-4 w-4 shrink-0 text-ink-muted" />
                        Alerts
                      </Link>
                      <Link
                        href="/messages"
                        className="flex items-center gap-3 px-5 py-2.5 text-sm text-ink hover:bg-gray-100 transition-colors"
                        onClick={() => setProfileOpen(false)}
                      >
                        <MessageCircle className="h-4 w-4 shrink-0 text-ink-muted" />
                        Messages
                      </Link>
                    </div>

                    <div className="border-t border-black/[0.06]" />

                    <div className="px-2 py-3">
                      <div className="flex items-stretch text-sm gap-1">
                        <button
                          className="flex flex-1 items-center gap-2 px-4 py-2.5 text-ink hover:bg-gray-100 transition-colors rounded-l-md border border-surface-border whitespace-nowrap"
                          onClick={() => setProfileOpen(false)}
                        >
                          <UserPlus className="h-4 w-4 shrink-0" />
                          Add account
                        </button>
                        <button
                          onClick={() => {
                            logout();
                            setProfileOpen(false);
                          }}
                          className="flex flex-1 items-center gap-2 px-4 py-2.5 text-ink hover:bg-gray-100 transition-colors rounded-r-md border border-surface-border whitespace-nowrap"
                        >
                          <LogOut className="h-4 w-4 shrink-0" />
                          Sign out
                        </button>
                      </div>
                    </div>

                    <p className="pb-3 text-center text-[11px] text-ink-muted/70">
                      <Link
                        href="/privacy"
                        onClick={() => setProfileOpen(false)}
                        className="hover:underline"
                      >
                        Privacy Policy
                      </Link>
                      {' Â· '}
                      <Link
                        href="/terms"
                        onClick={() => setProfileOpen(false)}
                        className="hover:underline"
                      >
                        Terms of Service
                      </Link>
                    </p>
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
        </div>
      </header>
    </>
  );
}

/**
 * The account control while we do not yet know whether anyone is signed in.
 *
 * Circular, because it stands in for the avatar — the richer of the two outcomes, and the one a
 * returning visitor (the only kind who can be signed in) is about to get. A signed-out visitor
 * lands a wider Sign-in button in the same slot; the slot's `min-w` already reserves that width,
 * so the swap changes what is in the box, never the size of it.
 *
 * Painted with the same `bg-surface-soft skeleton-fill` pairing as every listing placeholder, so
 * the header sweeps on the same clock and in the same colour as the cards below it rather than
 * inventing a second loading vocabulary for the chrome. `--skeleton-tint` on `:root` drives both.
 *
 * `aria-hidden` rather than a `role="status"`: the nav around it is fully interactive the whole
 * time, so this is not a page-level loading state to announce — it is one control not yet resolved,
 * and a screen reader reaching an unlabelled busy region in the header would be noise, not news.
 */
function NavAuthSkeleton() {
  return <SkeletonBlock className="h-10 w-10 rounded-full" />;
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
