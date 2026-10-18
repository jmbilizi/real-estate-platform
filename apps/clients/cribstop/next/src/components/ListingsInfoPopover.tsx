'use client';

import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

/**
 * The "About these listings" control (#947). The summary and the attribution take no row of their
 * own. Both stay in the server HTML. A closed panel is visually hidden, not removed, so a crawler
 * and a screen reader still read it. Opening it fetches nothing.
 *
 * The Bright MLS IDX disclosures (Rules §4(f)) stay legible in the site footer on every page.
 */
export default function ListingsInfoPopover({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  return (
    <span ref={root} className="inline-flex shrink-0 md:relative">
      <button
        ref={button}
        type="button"
        aria-label="About these listings"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-ink-muted transition-colors duration-150 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4M12 8h.01" />
        </svg>
      </button>
      <div
        id={panelId}
        role="region"
        aria-label="About these listings"
        className={
          open
            ? 'absolute inset-x-5 top-full z-30 mt-1 whitespace-normal rounded-xl border border-surface-border bg-white p-4 text-left shadow-lg md:inset-x-auto md:left-0 md:w-80'
            : 'sr-only'
        }
      >
        {children}
      </div>
    </span>
  );
}
