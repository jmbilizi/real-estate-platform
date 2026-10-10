'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BRAND } from '@/lib/brand';
import { DropdownContainer } from './DropdownContainer';
import { MORE_ICON } from './ToolbarIconButton';

export type NavMenuItem =
  | { kind: 'link'; label: string; href: string }
  | { kind: 'action'; label: string; action: 'login' | 'signup' | 'logout' };

/**
 * Secondary items. Each has a real destination today. Language and Settings are absent on
 * purpose: the app has no language support and no settings page (#767).
 */
export const SECONDARY_ITEMS: NavMenuItem[] = [
  { kind: 'link', label: 'Help', href: `mailto:${BRAND.contactEmail}` },
  { kind: 'link', label: 'About', href: '/about' },
  { kind: 'link', label: 'Fair Housing', href: '/fair-housing' },
  { kind: 'link', label: 'Accessibility', href: '/accessibility' },
  { kind: 'link', label: 'Privacy Policy', href: '/privacy' },
  { kind: 'link', label: 'Terms of Service', href: '/terms' },
];

export function getNavMenuItems(signedIn: boolean): {
  primary: NavMenuItem[];
  secondary: NavMenuItem[];
} {
  const primary: NavMenuItem[] = signedIn
    ? [
        { kind: 'link', label: 'Account', href: '/account' },
        { kind: 'link', label: 'Saved homes', href: '/favorites' },
        { kind: 'action', label: 'Log out', action: 'logout' },
      ]
    : [
        { kind: 'action', label: 'Log in', action: 'login' },
        { kind: 'action', label: 'Sign up', action: 'signup' },
      ];
  return { primary, secondary: SECONDARY_ITEMS };
}

const ITEM_CLASS =
  'block w-full px-4 py-2.5 text-left text-sm text-ink hover:bg-gray-100 focus:bg-gray-100 focus:outline-none';

/** The More (3 vertical dots) menu at the far right of the navbar. */
export default function NavMenu({
  signedIn,
  onAuth,
  onLogout,
}: {
  signedIn: boolean;
  onAuth: (mode: 'login' | 'signup') => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { primary, secondary } = getNavMenuItems(signedIn);

  const close = useCallback(() => setOpen(false), []);

  // DropdownContainer closes on Esc and outside click. Only Esc returns focus to the trigger.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') triggerRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    // Width only: a mobile URL bar fires `resize` on scroll, and the panel is placed by width.
    const width = window.innerWidth;
    const onResize = () => {
      if (window.innerWidth !== width) close();
    };
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [open, close]);

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  const select = (item: NavMenuItem) => {
    close();
    if (item.kind !== 'action') return;
    if (item.action === 'logout') onLogout();
    else onAuth(item.action);
  };

  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const els = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    const i = els.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      els[(n + els.length) % els.length]?.focus();
    };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(els.length - 1);
    else if (e.key === 'Tab') close();
  };

  const renderItem = (item: NavMenuItem) =>
    item.kind === 'link' ? (
      <Link
        key={item.label}
        href={item.href}
        role="menuitem"
        className={ITEM_CLASS}
        onClick={close}
      >
        {item.label}
      </Link>
    ) : (
      <button
        key={item.label}
        type="button"
        role="menuitem"
        className={ITEM_CLASS}
        onClick={() => select(item)}
      >
        {item.label}
      </button>
    );

  return (
    <>
      {/* A bare glyph at the far right, like other sites: no fill, no padding. The pseudo element keeps a 44px tap target. */}
      <button
        ref={triggerRef}
        type="button"
        aria-label="More options"
        title="More options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center text-ink before:absolute before:-inset-2.5 before:content-[''] hover:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 rounded"
      >
        {MORE_ICON}
      </button>
      {open && (
        <DropdownContainer onClose={close} alignRight triggerRef={triggerRef}>
          <div
            ref={menuRef}
            role="menu"
            aria-label="More options"
            onKeyDown={onMenuKeyDown}
            className="w-60 py-2"
          >
            {primary.map(renderItem)}
            <div role="separator" className="my-2 border-t border-black/[0.08]" />
            {secondary.map(renderItem)}
          </div>
        </DropdownContainer>
      )}
    </>
  );
}
