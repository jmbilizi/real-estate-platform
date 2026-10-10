'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BRAND } from '@/lib/brand';
import SlidePanel from './SlidePanel';
import { MORE_ICON } from './ToolbarIconButton';

export type NavMenuItem =
  | { kind: 'link'; label: string; href: string }
  | { kind: 'action'; label: string; action: 'auth' };

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
  // Signed in: the profile panel already has Account, Saved homes and Sign out. Do not repeat them.
  const primary: NavMenuItem[] = signedIn
    ? []
    : [{ kind: 'action', label: 'Sign in or sign up', action: 'auth' }];
  return { primary, secondary: SECONDARY_ITEMS };
}

const ITEM_CLASS =
  'block w-full px-5 py-2.5 text-left text-sm text-ink hover:bg-gray-100 focus:bg-gray-100 focus:outline-none';

/** The More (3 vertical dots) menu at the far right of the navbar. It uses the Apps panel. */
export default function NavMenu({ signedIn, onAuth }: { signedIn: boolean; onAuth: () => void }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // SlidePanel closes on the trigger's mousedown. The click that follows must not reopen it.
  const openAtMouseDown = useRef(false);
  const { primary, secondary } = getNavMenuItems(signedIn);

  const close = useCallback(() => setOpen(false), []);

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
        onClick={() => {
          close();
          onAuth();
        }}
      >
        {item.label}
      </button>
    );

  return (
    <>
      {/*
       * A bare 24px glyph: no fill, no padding, no margin. The navbar's flex gap sets the space to
       * its neighbours. The pseudo element makes a 44px high tap target. It reaches into the gap on
       * the left and the page padding on the right, so it overlaps no neighbour.
       */}
      <button
        ref={triggerRef}
        type="button"
        aria-label="More options"
        title="More options"
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={() => {
          openAtMouseDown.current = open;
        }}
        onClick={() => {
          if (openAtMouseDown.current) openAtMouseDown.current = false;
          else setOpen((v) => !v);
        }}
        className="relative inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-ink before:absolute before:-inset-y-2.5 before:-left-1.5 before:-right-3 before:content-[''] md:before:-left-2 hover:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1"
      >
        {MORE_ICON}
      </button>
      <SlidePanel open={open} onClose={close} width={314}>
        <div
          ref={menuRef}
          role="menu"
          aria-label="More options"
          onKeyDown={onMenuKeyDown}
          className="py-2"
        >
          {primary.map(renderItem)}
          {primary.length > 0 && (
            <div role="separator" className="mx-4 my-2 border-t border-black/[0.06]" />
          )}
          {secondary.map(renderItem)}
        </div>
      </SlidePanel>
    </>
  );
}
