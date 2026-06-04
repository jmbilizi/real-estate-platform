'use client';

import { useEffect, useRef } from 'react';

/**
 * SlidePanel — a reusable right-anchored dropdown panel.
 *
 * A fixed panel that slides in from the top-right with a backdrop.
 *
 * Usage:
 *   <SlidePanel open={open} onClose={onClose} title="Apps">
 *     {children}
 *   </SlidePanel>
 */
interface SlidePanelProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** px width of the panel. Defaults to 360. */
  width?: number;
}

export default function SlidePanel({
  open,
  onClose,
  title,
  children,
  width = 360,
}: SlidePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Use capture so it fires before any inner click handlers
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[99] pointer-events-none" aria-hidden />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ width }}
        className={[
          'fixed top-[64px] right-3 z-[100]',
          'rounded-3xl bg-white',
          'border border-black/[0.06]',
          'shadow-[0_2px_6px_rgba(0,0,0,0.05),0_8px_24px_rgba(0,0,0,0.1),0_16px_48px_rgba(0,0,0,0.06)]',
          'animate-panel-in',
        ].join(' ')}
      >
        {title && (
          <div className="flex items-center justify-between pl-5 pr-2 pt-3 pb-2">
            <span className="text-[13px] font-semibold tracking-wide text-ink">{title}</span>
            <button
              onClick={onClose}
              aria-label="Close"
              className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted hover:bg-surface-alt transition-colors"
            >
              <svg
                className="h-[18px] w-[18px]"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        <div className="overflow-y-auto max-h-[calc(100vh-84px)]">{children}</div>
      </div>

      <style>{`
        @keyframes panel-in {
          from { opacity: 0; transform: translateY(-10px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0)    scale(1); }
        }
        .animate-panel-in {
          animation: panel-in 0.2s cubic-bezier(0.16,1,0.3,1) both;
        }
      `}</style>
    </>
  );
}
