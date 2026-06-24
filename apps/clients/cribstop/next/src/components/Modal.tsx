import React, { ReactNode, useEffect, useRef, useState } from 'react';
import DismissButton from '@/components/DismissButton';

// Module-level: survives React Strict Mode unmount/remount cycles (unlike useRef)
let scheduledScrollUnlock: ReturnType<typeof setTimeout> | null = null;

function lockScroll() {
  // Cancel any pending deferred unlock first (handles Strict Mode re-mount)
  if (scheduledScrollUnlock !== null) {
    clearTimeout(scheduledScrollUnlock);
    scheduledScrollUnlock = null;
  }
  // Only measure when the scrollbar is still visible (skip on Strict Mode re-mount)
  if (document.documentElement.style.overflow !== 'hidden') {
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.documentElement.style.paddingRight = `${scrollbarWidth}px`;
    document.documentElement.style.overflow = 'hidden';
  }
}

function unlockScroll() {
  document.documentElement.style.paddingRight = '';
  document.documentElement.style.overflow = '';
}

function deferUnlockScroll() {
  // Schedules unlock as a macrotask — Strict Mode re-mount cancels it via lockScroll()
  // before it ever fires, so scroll stays locked across the double-mount cycle
  scheduledScrollUnlock = setTimeout(() => {
    scheduledScrollUnlock = null;
    unlockScroll();
  }, 0);
}

type MobileStyle = 'center' | 'bottom-sheet' | 'full-screen';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
  footer?: ReactNode;
  widthClass?: string;
  heightClass?: string;
  /**
   * Controls mobile presentation (sm+ is always a centered dialog):
   * - "center"       — centered floating dialog (default)
   * - "bottom-sheet" — slides up from bottom edge, rounded top corners, partial height
   * - "full-screen"  — fills the entire viewport
   */
  mobileStyle?: MobileStyle;
  /** Replaces the default "bg-white shadow-xl" on the card — useful when the content provides its own card styling */
  cardClassName?: string;
  /** Show a floating close button in the top-right corner even when no title is given */
  showCloseButton?: boolean;
  /** Remove default px-6 py-4 padding from the content area */
  noPadding?: boolean;
  /** Remove bottom border radius (useful for large modals where a flat bottom looks cleaner) */
  squareBottom?: boolean;
  /** Disable scrolling on the content div — let children manage their own scroll */
  noScroll?: boolean;
}

export default function Modal({
  open,
  onClose,
  children,
  title,
  footer,
  widthClass,
  heightClass,
  mobileStyle = 'center',
  cardClassName,
  showCloseButton,
  noPadding,
  squareBottom,
  noScroll,
}: ModalProps) {
  // mounted: controls DOM presence; visible: drives CSS transition
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  // Keep a stable ref so the Escape handler always calls the latest onClose
  // without adding onClose to the effect's dependency array.
  // This prevents unnecessary cleanup/re-run cycles every time the parent
  // re-renders (e.g. AuthModalWrapper recreating handleClose after each
  // router/searchParams update), which was causing the deferred unlock to
  // race against the re-lock and briefly show the page scrollbar.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (open) {
      lockScroll();
      setMounted(true);
      const raf = requestAnimationFrame(() => setVisible(true));
      const handleKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onCloseRef.current();
      };
      window.addEventListener('keydown', handleKey);

      return () => {
        cancelAnimationFrame(raf);
        window.removeEventListener('keydown', handleKey);
        // Defer unlock — Strict Mode re-mount will cancel it via lockScroll() before it fires
        deferUnlockScroll();
      };
    } else {
      // The cleanup of the open=true branch just scheduled a deferred unlock
      // (setTimeout 0). Cancel it immediately — we own the unlock timing now
      // and will fire it properly after the 300ms exit animation.
      if (scheduledScrollUnlock !== null) {
        clearTimeout(scheduledScrollUnlock);
        scheduledScrollUnlock = null;
      }
      // Slide out, then remove from DOM and unlock
      setVisible(false);
      const timer = setTimeout(() => {
        setMounted(false);
        unlockScroll();
      }, 300);
      return () => {
        clearTimeout(timer);
        // Unmounted mid-animation (e.g. route change) — unlock immediately
        unlockScroll();
      };
    }
  }, [open]); // onClose intentionally excluded — accessed via ref above

  if (!mounted) return null;

  // Backdrop alignment
  const backdropAlign = mobileStyle === 'center' ? 'items-center' : 'items-end sm:items-center';

  // Card shape & size per mobileStyle
  const cardMobile =
    mobileStyle === 'full-screen'
      ? 'h-screen rounded-none sm:h-auto sm:rounded-2xl'
      : mobileStyle === 'bottom-sheet'
        ? 'rounded-t-2xl rounded-b-none sm:rounded-2xl max-h-[85vh] sm:max-h-none'
        : 'rounded-2xl';

  // Slide-in animation per mobileStyle (desktop always fades in via backdrop)
  const slideFrom =
    mobileStyle === 'center'
      ? '' // no slide on mobile for center
      : 'translate-y-full sm:translate-y-0 sm:scale-95 sm:opacity-0';
  const slideTo = mobileStyle === 'center' ? '' : 'translate-y-0 sm:scale-100 sm:opacity-100';

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-center overflow-hidden bg-black/30 ${backdropAlign}`}
    >
      <div
        className={`relative w-full flex flex-col
          transition-[transform,opacity] duration-300 ease-out
          ${cardClassName ?? 'bg-white shadow-xl'}
          ${cardMobile}
          ${squareBottom ? 'sm:rounded-b-none' : ''}
          ${widthClass ?? 'max-w-md sm:max-w-lg'}
          ${mobileStyle !== 'full-screen' && mobileStyle !== 'bottom-sheet' ? (heightClass ?? 'max-h-[90vh]') : (heightClass ?? '')}
          ${visible ? slideTo : slideFrom}`}
      >
        {!title && showCloseButton && (
          <div className="absolute right-4 top-4 z-20">
            <DismissButton onClick={onClose} />
          </div>
        )}
        {title && (
          <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-surface-border relative flex-shrink-0">
            <h2 className="text-lg font-semibold mx-auto">{title}</h2>
            <DismissButton onClick={onClose} className="absolute right-4 top-4" />
          </div>
        )}
        <div
          className={
            noScroll
              ? `flex-1 min-h-0 flex flex-col overflow-hidden${noPadding ? '' : ' px-6 py-4'}`
              : `flex-1 overflow-y-auto ${mobileStyle === 'full-screen' ? 'scrollbar-invisible' : ''} ${noPadding ? '' : 'px-6 py-4'}`
          }
        >
          {children}
        </div>
        {footer && (
          <div className="sticky bottom-0 left-0 right-0 px-6 py-4 bg-white border-t border-surface-border flex items-center justify-between gap-3 rounded-b-2xl flex-shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
