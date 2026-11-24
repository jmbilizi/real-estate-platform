'use client';

import Link from 'next/link';
import { useApp } from '@/lib/context';
import { useEffect, useLayoutEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { motion } from 'motion/react';
import { Clock, Heart, LogOut, User as UserIcon, UserPlus } from 'lucide-react';
import MobileSearchSheet from './MobileSearchSheet';
import MobileSearchPill from './MobileSearchPill';
import SlidePanel from './SlidePanel';
import DismissButton from './DismissButton';
import BrandMark from './BrandMark';
import { openAuthModal } from '@/lib/auth-modal';
import { getUserDisplayName, getUserInitials, type User } from '@/lib/store/types';
import { PRIMARY_TABS } from './MobileTabBar';
import { SkeletonBlock } from './Skeleton';
import NavMenu from './NavMenu';
import { MORE_ICON } from './ToolbarIconButton';

/**
 * The account control. It has the shape of a primary tab: a line icon, then a label from `lg`.
 * 44px tall and at least 44px wide, so it is a full tap target when the label is hidden.
 */
const ACCOUNT_CLASSES =
  'flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-3 text-[15px] font-semibold text-ink-muted transition-colors duration-150 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand';
const ACCOUNT_ICON_CLASSES = 'h-6 w-6 shrink-0 lg:h-5 lg:w-5';
/** Active on an account page: the brand color on a phone (as the tab bar), ink from `md` (as a tab). */
const ACCOUNT_ACTIVE_CLASSES = 'text-brand md:text-ink';

/** The pages the account control owns. On them it is the active item, and no primary tab is. */
const ACCOUNT_PREFIXES = ['/account'];

export function isAccountPath(pathname: string): boolean {
  return ACCOUNT_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

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

  /*
   * An account page makes the account control the active item. A tab click clears it at once
   * (`leftPath`), because the click sets the tab and then navigates, so the route is late.
   */
  const [leftPath, setLeftPath] = useState<string | null>(null);
  useEffect(() => {
    setLeftPath(null);
  }, [pathname]);
  const accountActive = isAccountPath(pathname) && leftPath !== pathname;

  // Keep the store in step with the route for everything else that reads `activeTab`.
  useEffect(() => {
    setActiveTab(tabFromPath);
  }, [tabFromPath, setActiveTab]);

  // Collapse expanded search on every navigation, not only a tab change. Keyed on `pathname`,
  // not `tabFromPath`, so navigating within a tab (for example home to a listing) still closes it.
  useEffect(() => {
    setHeaderExpanded(false);
  }, [pathname, setHeaderExpanded]);

  // Collapse expanded search when ScrollSentinel scrolls back into view
  useEffect(() => {
    if (!showHeaderPill) setHeaderExpanded(false);
  }, [showHeaderPill, setHeaderExpanded]);

  // Sync data-header-expanded attribute
  useEffect(() => {
    if (headerExpanded) {
      document.documentElement.setAttribute('data-header-expanded', '');
    } else {
      document.documentElement.removeAttribute('data-header-expanded');
      // Only on close: the search opens with the panel of the field the user clicked.
      window.dispatchEvent(new Event('searchbar:close'));
    }
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

  const openModal = () => {
    openAuthModal('login');
  };

  return (
    <>
      {/* Mobile full-screen search sheet */}
      {mobileSearchOpen && <MobileSearchSheet onClose={() => setMobileSearchOpen(false)} />}

      {/*
       * The scrim behind the open search bar: it dims the page, and a click on it closes the bar.
       * The header sits above it (`z-chrome` inside the sticky wrapper), so the header stays
       * bright and usable. The open bar is on the `searchBar` layer, above both.
       */}
      {headerExpanded && showHeaderPill && (
        <div
          data-testid="search-scrim"
          className="fixed inset-0 z-nav-backdrop animate-fade-in bg-black/25"
          onClick={() => setHeaderExpanded(false)}
        />
      )}

      <header className="relative z-chrome overflow-visible bg-white">
        {/*
         * One row at every width. Phones (#943): brand mark | search pill | Account, with the tabs
         * in the bottom bar. From `md`: brand mark | search pill | tabs | Account, More.
         * Nothing in the row moves on scroll.
         */}
        <div className="page-gutter relative flex h-16 items-center gap-2 md:gap-4 lg:gap-6">
          {/*
           * Logo: the "cs" mark, the same at every width. It renders unconditionally, never behind
           * the `hydrated` gate. The mark is 36px wide, so the search pill's left edge is a known
           * value (`--header-pill-left` in globals.css).
           */}
          <BrandMark />

          {/*
           * The search pill's slot. The pill is `CompactSearchBar`, rendered from `ScrollSentinel`
           * and fixed over this box: both read `--header-pill-left` and `--header-pill-w`. The
           * slot only reserves the width, so the tabs start after the pill.
           */}
          <div aria-hidden="true" className="header-pill-slot h-11 flex-shrink-0 max-md:hidden" />

          {/*
           * Primary tabs: the same three destinations and line icons as the phone tab bar
           * (`PRIMARY_TABS`), so the two bars read as one navigation. Icons only from `md`, icon
           * and label from `lg`. They are real links in the server HTML and they show on every
           * page. `ml-auto` puts them on the right, beside the account control.
           */}
          <nav aria-label="Primary" className="ml-auto hidden h-16 items-stretch gap-1 md:flex">
            {PRIMARY_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = !accountActive && displayTab === tab.id;
              return (
                <Link
                  key={tab.id}
                  href={tab.href}
                  aria-label={tab.label}
                  aria-current={isActive ? 'page' : undefined}
                  title={tab.label}
                  onClick={() => {
                    setActiveTab(tab.id);
                    setLeftPath(pathname);
                  }}
                  className={`relative flex min-w-12 items-center justify-center gap-1.5 px-3 text-[15px] font-semibold transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand ${
                    isActive ? 'text-ink' : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  <Icon
                    className="h-6 w-6 shrink-0 lg:h-5 lg:w-5"
                    strokeWidth={isActive ? 2.25 : 1.75}
                    aria-hidden="true"
                  />
                  <span className="hidden lg:inline">{tab.label}</span>
                  {/* The underline slides between tabs. `isActive` resolves from the route before
                      hydration (`displayTab`), so the server ships it under the correct tab. */}
                  {isActive && (
                    <motion.span
                      layoutId="nav-tab-underline"
                      className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-brand"
                      transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                    />
                  )}
                </Link>
              );
            })}
          </nav>

          <div className="flex min-w-0 flex-1 md:hidden">
            <MobileSearchPill />
          </div>

          {/* Right nav */}
          {/* From `md` the negative margin cancels the row gap down to 4px, the gap between two
              tabs. Account has the padding of a tab, so Connect to Account reads as one more step
              of the same rhythm. */}
          <div className="relative z-20 flex flex-shrink-0 items-center gap-1.5 md:-ml-3 md:gap-2 lg:-ml-5">
            {/*
             * There is no Saved button in the row. A signed-in user gets "Saved" in the
             * account panel, and phones have Saved in the bottom tab bar (#923). There is no Apps
             * grid: one destination shows once.
             */}
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
             * Signed out it is the account icon and "Sign in". Signed in it is the account icon (or
             * the photo) and the first name, and it opens the account panel. The label shows from
             * `lg`, the same as the tab labels.
             */}
            <div
              className={`relative flex h-16 items-center justify-end ${hydrated ? 'content-resolved' : ''}`}
            >
              {/* The same underline as the tabs (one `layoutId`), so it slides to Account. */}
              {accountActive && (
                <motion.span
                  layoutId="nav-tab-underline"
                  data-testid="account-active-underline"
                  className="absolute inset-x-2 bottom-0 hidden h-[2px] rounded-full bg-brand md:block"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
              {!hydrated ? (
                <AccountSkeleton active={accountActive} />
              ) : user ? (
                <div className="relative">
                  <button
                    type="button"
                    aria-label="Profile menu"
                    title="Profile menu"
                    aria-expanded={profileOpen}
                    aria-haspopup="dialog"
                    aria-current={accountActive ? 'page' : undefined}
                    onClick={() => setProfileOpen((v) => !v)}
                    className={`${ACCOUNT_CLASSES} ${
                      accountActive ? ACCOUNT_ACTIVE_CLASSES : profileOpen ? 'text-ink' : ''
                    }`}
                  >
                    {user.avatar ? (
                      <img
                        src={user.avatar}
                        alt=""
                        className="h-7 w-7 shrink-0 rounded-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <UserIcon
                        className={ACCOUNT_ICON_CLASSES}
                        strokeWidth={accountActive ? 2.25 : 1.75}
                        aria-hidden="true"
                      />
                    )}
                    <span className="hidden max-w-[5rem] truncate lg:inline">
                      {accountLabel(user)}
                    </span>
                  </button>

                  <SlidePanel open={profileOpen} onClose={() => setProfileOpen(false)} width={314}>
                    <div className="absolute right-2 top-2">
                      <DismissButton onClick={() => setProfileOpen(false)} />
                    </div>

                    {/* Avatar + name + email */}
                    <div className="flex flex-col items-center px-5 pt-6 pb-4 gap-2">
                      {user.avatar ? (
                        <img
                          src={user.avatar}
                          alt=""
                          className="h-16 w-16 flex-shrink-0 rounded-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <span className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full bg-brand font-bold text-white text-xl">
                          {getUserInitials(user)}
                        </span>
                      )}
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
                        href="/account/favorites"
                        className="flex items-center gap-3 px-5 py-2.5 text-sm text-ink hover:bg-gray-100 transition-colors"
                        onClick={() => setProfileOpen(false)}
                      >
                        <Heart className="h-4 w-4 shrink-0 text-ink-muted" />
                        Saved
                      </Link>
                      <Link
                        href="/account/recently-viewed"
                        className="flex items-center gap-3 px-5 py-2.5 text-sm text-ink hover:bg-gray-100 transition-colors"
                        onClick={() => setProfileOpen(false)}
                      >
                        <Clock className="h-4 w-4 shrink-0 text-ink-muted" />
                        Recently viewed
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
                      {' · '}
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
                  type="button"
                  aria-label="Sign in or sign up"
                  title="Sign in or sign up"
                  aria-current={accountActive ? 'page' : undefined}
                  onClick={() => openModal()}
                  className={`${ACCOUNT_CLASSES} ${accountActive ? ACCOUNT_ACTIVE_CLASSES : ''}`}
                >
                  <UserIcon
                    className={ACCOUNT_ICON_CLASSES}
                    strokeWidth={accountActive ? 2.25 : 1.75}
                    aria-hidden="true"
                  />
                  <span className="hidden whitespace-nowrap lg:inline">Sign in</span>
                </button>
              )}
            </div>

            {hydrated ? (
              <span className="content-resolved flex items-center">
                <NavMenu signedIn={!!user} onAuth={openModal} />
              </span>
            ) : (
              /* The dots look the same for every visitor, so they are drawn for real before
                 hydration. Only the menu behind them waits for the bundle. */
              <span
                aria-hidden="true"
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-ink md:-mr-1 md:w-1 md:justify-end"
              >
                {MORE_ICON}
              </span>
            )}
          </div>
        </div>
      </header>
    </>
  );
}

/** The label beside the account icon: the first name, or "Account" when the profile has none. */
function accountLabel(user: User): string {
  const first = (user.firstName || user.displayName || '').trim().split(/\s+/)[0];
  return first || 'Account';
}

/**
 * The account control before hydration, when the user is not known. The icon is the same for a
 * signed-in and a signed-out visitor, so it is drawn for real. Only the label is unknown ("Sign in"
 * or a first name), so only the label is a placeholder bar, with the width of "Sign in". The box is
 * the loaded control's (`ACCOUNT_CLASSES`), so the search pill and the tabs do not move when the
 * real control arrives. `aria-hidden`: this is one unresolved control, not a page-level loading
 * state to announce.
 */
function AccountSkeleton({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`${ACCOUNT_CLASSES} pointer-events-none ${active ? ACCOUNT_ACTIVE_CLASSES : ''}`}
    >
      <UserIcon className={ACCOUNT_ICON_CLASSES} strokeWidth={active ? 2.25 : 1.75} />
      <SkeletonBlock className="hidden h-3.5 w-12 rounded lg:block" />
    </span>
  );
}
