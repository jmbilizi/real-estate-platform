let configuredOrigin: string | null = null;

/**
 * Fetches the server's `SITE_ORIGIN` once and keeps it for `shareOrigin`. Share handlers read the
 * cache synchronously, because `navigator.share` must run inside the click's user gesture.
 */
export async function warmSiteOrigin(): Promise<void> {
  try {
    const res = await fetch('/api/site-origin');
    if (!res.ok) return;
    const body = (await res.json()) as { origin?: unknown };
    if (typeof body.origin === 'string' && body.origin) configuredOrigin = body.origin;
  } catch {
    // Share links fall back to the current origin.
  }
}

/** The origin a share link uses: the one the page declares as canonical, else the current one. */
export function shareOrigin(): string {
  return configuredOrigin ?? window.location.origin;
}

/** Test seam. */
export function setSiteOriginForTest(origin: string | null): void {
  configuredOrigin = origin;
}
