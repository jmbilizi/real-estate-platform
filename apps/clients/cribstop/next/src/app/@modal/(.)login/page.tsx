import { Suspense } from 'react';
import AuthModalWrapper from '@/components/AuthModalWrapper';

/**
 * `AuthModalWrapper` reads `useSearchParams()`, which opts its subtree out of static prerendering
 * unless it sits inside a Suspense boundary. Without one, `next build` fails this route with
 * "useSearchParams() should be wrapped in a suspense boundary". This route was relying on the root
 * layout's client boundaries to cover it, which is not something a page should depend on.
 *
 * Note the cost, and why the search page deliberately does *not* do this: a boundary keeps whatever
 * is inside it out of the first HTML, and ships its fallback there instead. That is free here —
 * there is nothing to show behind a closed modal, so the fallback is `null` — and it is emphatically
 * not free for a page whose whole body sits inside one.
 */
export default function LoginModal() {
  return (
    <Suspense fallback={null}>
      <AuthModalWrapper initialMode="login" />
    </Suspense>
  );
}
