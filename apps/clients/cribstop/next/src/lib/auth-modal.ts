export type AuthModalMode = 'login' | 'signup';

/** True while the modal entry this document pushed is still on the history stack. */
let pushedEntry = false;

function urlWith(mutate: (params: URLSearchParams) => void): string {
  const params = new URLSearchParams(window.location.search);
  mutate(params);
  const qs = params.toString();
  return qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
}

/**
 * Opens the auth modal over the current page.
 *
 * Uses the native History API, not `router.push`. A router navigation to `?modal=login` asks the
 * server for a new RSC payload and re-renders the route behind the modal (#908). `pushState` only
 * moves the URL. Next.js keeps `useSearchParams` in step, so `AuthModalListener` still opens.
 */
export function openAuthModal(mode: AuthModalMode = 'login', opts?: { forgot?: boolean }): void {
  const url = urlWith((p) => {
    p.set('modal', mode);
    if (opts?.forgot) p.set('mode', 'forgot');
    else p.delete('mode');
  });
  window.history.pushState(null, '', url);
  pushedEntry = true;
}

/**
 * Closes the auth modal without a navigation. Steps back when this document pushed the entry, so
 * Back does not reopen the modal. Otherwise (a hard load on `?modal=login`) it replaces the URL.
 */
export function closeAuthModal(): void {
  if (pushedEntry) {
    pushedEntry = false;
    window.history.back();
    return;
  }
  window.history.replaceState(
    null,
    '',
    urlWith((p) => {
      p.delete('modal');
      p.delete('mode');
    }),
  );
}
