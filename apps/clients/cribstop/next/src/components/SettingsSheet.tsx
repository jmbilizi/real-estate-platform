'use client';

import { useApp } from '@/lib/context';
import { openAuthModal } from '@/lib/auth-modal';
import Modal from './Modal';
import { NavMenuItems } from './NavMenu';

/**
 * The phone Settings sheet (#943). It shows the items the desktop 3-dot menu shows, in a bottom
 * sheet. `Modal` locks page scroll, and the tab bar hides while it is open.
 */
export default function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useApp();
  return (
    <Modal open={open} onClose={onClose} title="Settings" mobileStyle="bottom-sheet" noPadding>
      <div
        role="menu"
        aria-label="Settings"
        className="py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
      >
        <NavMenuItems signedIn={!!user} onAuth={() => openAuthModal('login')} onDone={onClose} />
      </div>
    </Modal>
  );
}
