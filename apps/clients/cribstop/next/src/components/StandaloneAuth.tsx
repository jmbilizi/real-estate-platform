'use client';

import { useRouter } from 'next/navigation';
import AuthForm from './AuthForm';

/** Full-page auth for a hard load of `/login` or `/signup`. A soft open uses the modal (#908). */
export default function StandaloneAuth() {
  const router = useRouter();
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md items-center justify-center px-4 py-10">
      <AuthForm variant="page" onSuccess={() => router.replace('/')} />
    </div>
  );
}
