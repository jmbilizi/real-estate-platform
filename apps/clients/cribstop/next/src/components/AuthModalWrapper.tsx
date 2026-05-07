'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import AuthForm from './AuthForm';
import Modal from './Modal';

type Mode = 'login' | 'signup';

export default function AuthModalWrapper({ initialMode }: { initialMode: Mode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Modal's open state — set to false to play exit animation, then route away
  const [open, setOpen] = useState(true);

  const buildUrl = (params: URLSearchParams) => {
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  // Animate out first (Modal takes 300ms), then route
  const navigate = (url: string) => {
    setOpen(false);
    setTimeout(() => router.replace(url), 310);
  };

  const handleClose = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('modal');
    navigate(buildUrl(params));
  };

  const handleSuccess = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('modal');
    navigate(buildUrl(params));
  };

  const handleSwitchMode = (mode: 'login' | 'signup') => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('modal', mode);
    router.replace(buildUrl(params));
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
        <AuthForm
          variant="modal"
          initialMode={initialMode}
          onSuccess={handleSuccess}
          onSwitchMode={handleSwitchMode}
        />
      </div>
    </Modal>
  );
}
