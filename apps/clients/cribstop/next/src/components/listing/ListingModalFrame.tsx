'use client';

import type { ReactNode } from 'react';
import Modal from '@/components/Modal';

/**
 * The one definition of the listing detail modal's chrome.
 *
 * Three things render this panel — the modal itself, the route-level loading state, and the
 * intercepted open — and the user notices immediately when they disagree: the skeleton and the
 * loaded listing sit at the same place on screen, so a single differing dimension reads as the
 * border flashing or the photo jumping as data arrives. Keeping the props in one place is what
 * stops that from being a thing anyone has to remember.
 */
export default function ListingModalFrame({
  children,
  open = true,
  onClose,
  instant,
}: {
  children: ReactNode;
  /** Drives the close animation. Defaults open, which is what a non-interactive shell wants. */
  open?: boolean;
  /** Omitted by shells that cannot be closed because they are only on screen while data loads. */
  onClose?: () => void;
  /** Render in the first paint rather than after hydration — see `Modal`'s `instant`. */
  instant?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose ?? (() => {})}
      mobileStyle="full-screen"
      widthClass="sm:max-w-7xl"
      heightClass="sm:h-screen"
      noPadding
      squareBottom
      noScroll
      /* Full height from the first frame — this panel fills the viewport, so scaling it up from
         95% reads as the modal resizing itself rather than arriving. */
      noScaleIn
      instant={instant}
    >
      {children}
    </Modal>
  );
}
