'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { type LucideIcon, MoreVertical } from 'lucide-react';

export interface ListingCardMenuItem {
  label: string;
  /** Required, not optional: every item in this menu carries a leading icon (#452). */
  icon: LucideIcon;
  onSelect: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

const VIEWPORT_MARGIN = 8;

/**
 * The footer "more options" control (#452).
 *
 * It was a native `<details>`/`<summary>` pair with an absolutely positioned panel, a sibling of
 * the trigger in the normal flow. The card's own `overflow-hidden`, the carousel scroller's
 * `overflow-x-auto` (`ListingRow.tsx`), and the search grid all clip or hide an absolutely
 * positioned sibling, so the panel opened invisible or cut off on most of the surfaces this card
 * renders on.
 *
 * The panel now renders in a portal to `document.body`, fixed-positioned from the trigger's own
 * `getBoundingClientRect` — no ancestor's `overflow` or stacking context can reach it, whatever
 * surface the card is on.
 */
export default function ListingCardMenu({
  items,
  label = 'More options',
}: {
  items: ListingCardMenuItem[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function close() {
    setOpen(false);
  }

  function closeAndReturnFocus() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  // Computed after the panel has a real size to flip against — a panel whose own height is
  // unknown cannot decide whether it fits below the trigger.
  useLayoutEffect(() => {
    if (!open) return;
    const btn = buttonRef.current;
    const menu = menuRef.current;
    if (!btn || !menu) return;

    const rect = btn.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const flipAbove = spaceBelow < menuRect.height + VIEWPORT_MARGIN && rect.top > menuRect.height;

    const top = flipAbove ? rect.top - menuRect.height - 4 : rect.bottom + 4;
    // Right-aligned to the trigger (matches the old panel's `right-0`), then clamped inside the
    // viewport with an 8px margin on both sides.
    const idealLeft = rect.right - menuRect.width;
    const left = Math.min(
      Math.max(idealLeft, VIEWPORT_MARGIN),
      window.innerWidth - menuRect.width - VIEWPORT_MARGIN,
    );

    setCoords({ top, left });
  }, [open]);

  // Outside click, Escape, scroll and resize all close the menu. Scroll closes rather than
  // repositions: the trigger can sit inside a horizontally scrolling carousel (`ListingRow.tsx`),
  // and the one action this menu offers ("Copy link") has no reason to survive a scroll gesture.
  useEffect(() => {
    if (!open) return;

    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close();
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeAndReturnFocus();
      // Tab moves focus out of the menu (there is no focus trap here — every item carries
      // `tabIndex={-1}` and is reached only by arrow keys), so without this the panel stayed
      // visible, floating, with focus already gone from it.
      if (e.key === 'Tab') close();
    }
    function handleScrollOrResize() {
      close();
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    // `capture: true` — a scroll inside the carousel scroller does not bubble to `window`.
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [open]);

  function menuItemEls() {
    return Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
    );
  }

  function focusItem(index: number) {
    menuItemEls()[index]?.focus();
  }

  // The WAI-ARIA menu-button pattern: opening moves focus straight to the first item, rather
  // than leaving it on the trigger and requiring an extra keypress to reach the one action.
  useEffect(() => {
    if (open) focusItem(0);
  }, [open]);

  function handleMenuKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const els = menuItemEls();
    if (els.length === 0) return;
    const current = els.findIndex((el) => el === document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusItem((current + 1) % els.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      // `current === -1` (nothing in the menu has focus, e.g. focus was moved
      // programmatically) must wrap to the last item, matching Home/End below — the plain
      // modulo form lands one item short of that for a negative `current`.
      focusItem(current <= 0 ? els.length - 1 : current - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusItem(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusItem(els.length - 1);
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="group relative flex h-4 w-4 items-center justify-center rounded-full transition-colors hover:bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span aria-hidden="true" className="absolute -inset-0.5" />
        <MoreVertical
          size={16}
          className="stroke-ink-muted transition-transform group-hover:scale-110"
        />
      </button>
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={label}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={handleMenuKeyDown}
            style={{
              position: 'fixed',
              top: coords?.top ?? -9999,
              left: coords?.left ?? -9999,
              // Hidden until the first layout pass has measured the panel and placed it — avoids a
              // one-frame flash at the (0,0) fallback.
              visibility: coords ? 'visible' : 'hidden',
            }}
            className="z-50 w-32 rounded-md border border-surface-border bg-white py-1 shadow-card"
          >
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={(e) => {
                  item.onSelect(e);
                  closeAndReturnFocus();
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-ink hover:bg-surface-alt focus-visible:outline-none focus-visible:bg-surface-alt"
              >
                {/* `aria-hidden` — the button's accessible name is its text, not the icon. Fixed
                    width (matches the trigger's own 16px icons) so every item's label starts at
                    the same x regardless of which icon it carries. */}
                <item.icon size={16} aria-hidden="true" className="w-4 shrink-0 stroke-ink-muted" />
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
