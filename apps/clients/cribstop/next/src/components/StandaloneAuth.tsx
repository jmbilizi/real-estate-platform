'use client';

import { useRouter } from 'next/navigation';
import AuthForm from './AuthForm';
import DismissButton from './DismissButton';

/** Full-page auth for a hard load of `/login` or `/signup`. A soft open uses the modal (#908). */
export default function StandaloneAuth() {
  const router = useRouter();
  // A hard load has no history to step back through, so it leaves for the home page (#945).
  const leave = () => {
    if (window.history.length > 1) router.back();
    else router.replace('/');
  };
  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-md flex-col items-center justify-center px-4 py-10">
      <div className="flex h-14 w-full shrink-0 items-center justify-end">
        <DismissButton onClick={leave} />
      </div>
      <AuthForm variant="page" onSuccess={() => router.replace('/')} />
    </div>
  );
}
