'use client';

import { useSearchParams } from 'next/navigation';
import AuthModalWrapper from './AuthModalWrapper';

export default function AuthModalListener() {
  const searchParams = useSearchParams();
  const modal = searchParams.get('modal');

  if (modal !== 'login' && modal !== 'signup') return null;

  return <AuthModalWrapper initialMode={modal} />;
}
