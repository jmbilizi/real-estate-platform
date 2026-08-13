import { Suspense } from 'react';
import AuthModalWrapper from '@/components/AuthModalWrapper';

/**
 * `AuthModalWrapper` reads `useSearchParams()`, which opts its subtree out of static prerendering
 * unless it sits inside a Suspense boundary. Without one, `next build` fails this route with
 * "useSearchParams() should be wrapped in a suspense boundary". The search page already wraps its
 * content for exactly this reason; this route was relying on the root layout's client boundaries to
 * cover it, which is not something a page should depend on.
 */
export default function LoginModal() {
  return (
    <Suspense fallback={null}>
      <AuthModalWrapper initialMode="login" />
    </Suspense>
  );
}
