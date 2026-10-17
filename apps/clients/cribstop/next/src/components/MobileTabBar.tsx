'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Heart, Home, User, Users, Wrench } from 'lucide-react';

/**
 * The phone tab bar (#923). Every href is an existing route. A tab for a page the app does not
 * have (Inbox, Updates) is not added.
 */
export const MOBILE_TABS = [
  { id: 'homes', label: 'Homes', href: '/', icon: Home },
  { id: 'services', label: 'Services', href: '/services', icon: Wrench },
  { id: 'connect', label: 'Connect', href: '/connect', icon: Users },
  { id: 'saved', label: 'Saved', href: '/favorites', icon: Heart },
  // `/account` shows its own sign-in prompt when signed out, so one link serves both states and
  // the bar renders the same before and after hydration.
  { id: 'account', label: 'Account', href: '/account', icon: User },
] as const;

/** Routes that draw their own sticky bottom action bar. The tab bar would stack on it. */
const HIDDEN_PREFIXES = ['/property/', '/listing/'];

/** Height of the bar above the home-indicator inset. */
const BAR_HEIGHT = '3.5rem';

function isActive(id: (typeof MOBILE_TABS)[number]['id'], pathname: string): boolean {
  switch (id) {
    case 'homes':
      return !['/services', '/connect', '/favorites', '/account'].some(
        (p) => pathname === p || pathname.startsWith(`${p}/`),
      );
    case 'services':
      return pathname.startsWith('/services');
    case 'connect':
      return pathname.startsWith('/connect');
    case 'saved':
      return pathname.startsWith('/favorites');
    default:
      return pathname.startsWith('/account');
  }
}

/**
 * Fixed bottom navigation on phones. `md:hidden` keeps desktop unchanged. The spacer reserves the
 * bar's height at the end of the page so the footer, with its Real Broker disclosures, can scroll
 * clear of it. Dialogs (`z-dialog`) and the full-screen search sheet sit above the bar.
 */
export default function MobileTabBar() {
  const pathname = usePathname();
  if (HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return null;

  return (
    <>
      <div
        aria-hidden="true"
        data-testid="mobile-tab-bar-spacer"
        className="bg-surface-alt md:hidden"
        style={{ height: `calc(${BAR_HEIGHT} + env(safe-area-inset-bottom, 0px))` }}
      />
      <nav
        aria-label="Primary"
        data-testid="mobile-tab-bar"
        className="fixed inset-x-0 bottom-0 z-chrome border-t border-surface-border bg-white/95 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] backdrop-blur md:hidden"
      >
        <ul className="grid h-14 grid-cols-5">
          {MOBILE_TABS.map((tab) => {
            const active = isActive(tab.id, pathname);
            const Icon = tab.icon;
            return (
              <li key={tab.id} className="min-w-0">
                <Link
                  href={tab.href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex h-full min-h-11 touch-manipulation flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors active:bg-surface-alt ${
                    active ? 'text-brand' : 'text-ink-muted'
                  }`}
                >
                  <Icon className="h-6 w-6" strokeWidth={active ? 2.25 : 1.75} aria-hidden="true" />
                  <span className="truncate">{tab.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
