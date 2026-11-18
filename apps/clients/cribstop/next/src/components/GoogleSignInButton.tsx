'use client';

import { useEffect, useRef } from 'react';

const GIS_SRC = 'https://accounts.google.com/gsi/client';

type GoogleIdApi = {
  initialize: (config: {
    client_id: string;
    callback: (response: { credential?: string }) => void;
    ux_mode?: 'popup' | 'redirect';
  }) => void;
  renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
};

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleIdApi } };
  }
}

let loading: Promise<void> | null = null;

/** Loads Google Identity Services once. A failed load clears the cache so a later mount retries. */
function loadGis(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!loading) {
    loading = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = GIS_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        loading = null;
        script.remove();
        reject(new Error('Google sign-in did not load'));
      };
      document.head.appendChild(script);
    });
  }
  return loading;
}

/**
 * "Continue with Google" through Google Identity Services (#1049). Google draws the button. The
 * parent decides when to show it: it needs a client ID from `/api/google-config`.
 * `onCredential` gets the Google ID token. The server checks it, never this component.
 */
export default function GoogleSignInButton({
  clientId,
  onCredential,
}: {
  clientId: string;
  onCredential: (credential: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  // The latest callback, so a parent re-render never re-initializes Google.
  const callbackRef = useRef(onCredential);
  useEffect(() => {
    callbackRef.current = onCredential;
  }, [onCredential]);

  useEffect(() => {
    let cancelled = false;
    loadGis()
      .then(() => {
        const api = window.google?.accounts?.id;
        const host = hostRef.current;
        if (cancelled || !api || !host) return;
        api.initialize({
          client_id: clientId,
          callback: (response) => {
            if (response.credential) callbackRef.current(response.credential);
          },
        });
        api.renderButton(host, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'pill',
          logo_alignment: 'left',
          width: Math.min(400, Math.max(200, Math.round(host.clientWidth) || 200)),
        });
      })
      .catch(() => {
        // The script is blocked or offline. The email form still works.
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  return <div ref={hostRef} data-testid="google-signin" className="flex min-h-11 justify-center" />;
}
