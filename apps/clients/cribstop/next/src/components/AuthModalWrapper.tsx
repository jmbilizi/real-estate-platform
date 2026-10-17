'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import AuthForm from './AuthForm';
import Modal from './Modal';
import { closeAuthModal } from '@/lib/auth-modal';

export default function AuthModalWrapper() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // `?modal=login&mode=forgot` opens the sign-in modal on the reset screen (#662).
  const initialMode =
    searchParams.get('modal') === 'login' && searchParams.get('mode') === 'forgot'
      ? 'forgot'
      : 'login';

  // Modal's open state — set to false to play exit animation, then close
  const [open, setOpen] = useState(true);

  // Animate out first (Modal takes 300ms). The close is a History call, not a router navigation, so
  // the page behind the modal does not re-render or refetch (#908). The intercepted `/login` and
  // `/signup` routes sit on their own history entry, so they step back through the router.
  const close = () => {
    setOpen(false);
    setTimeout(() => {
      if (pathname === '/login' || pathname === '/signup') router.back();
      else closeAuthModal();
    }, 310);
  };

  return (
    <Modal
      open={open}
      onClose={close}
      mobileStyle="full-screen"
      widthClass="sm:max-w-md"
      cardClassName="bg-white sm:bg-transparent sm:shadow-none"
      showCloseButton
      noPadding
    >
      <div className="min-h-full flex items-center justify-center sm:block">
        <AuthForm variant="modal" initialMode={initialMode} onSuccess={close} />
      </div>
    </Modal>
  );
}
