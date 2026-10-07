'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import AuthForm from './AuthForm';
import Modal from './Modal';

export default function AuthModalWrapper() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // `?modal=login&mode=forgot` opens the sign-in modal on the reset screen (#662).
  const initialMode =
    searchParams.get('modal') === 'login' && searchParams.get('mode') === 'forgot'
      ? 'forgot'
      : 'login';

  // Modal's open state — set to false to play exit animation, then route away
  const [open, setOpen] = useState(true);

  const buildUrl = (params: URLSearchParams) => {
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  // Animate out first (Modal takes 300ms), then route
  const navigate = (url: string) => {
    setOpen(false);
    setTimeout(() => router.replace(url, { scroll: false }), 310);
  };

  const handleClose = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('modal');
    params.delete('mode');
    navigate(buildUrl(params));
  };

  const handleSuccess = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('modal');
    params.delete('mode');
    navigate(buildUrl(params));
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      mobileStyle="full-screen"
      widthClass="sm:max-w-md"
      cardClassName="bg-white sm:bg-transparent sm:shadow-none"
      showCloseButton
      noPadding
    >
      <div className="min-h-full flex items-center justify-center sm:block">
        <AuthForm variant="modal" initialMode={initialMode} onSuccess={handleSuccess} />
      </div>
    </Modal>
  );
}
