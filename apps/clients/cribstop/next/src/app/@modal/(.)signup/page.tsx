import { Suspense } from 'react';
import AuthModalWrapper from '@/components/AuthModalWrapper';

/** See the sibling login modal — `AuthModalWrapper` reads `useSearchParams()`. */
export default function SignupModal() {
  return (
    <Suspense fallback={null}>
      <AuthModalWrapper initialMode="signup" />
    </Suspense>
  );
}
