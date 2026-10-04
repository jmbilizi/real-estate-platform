import tourHosts from './tour-hosts.json';

export type TourEntry = { href: string; mode: 'frame' | 'tab' };

/**
 * Decides how the gallery opens a listing's virtual tour (#573).
 *
 * The URL is unvalidated MLS text, so only `https:` without credentials passes. A host in
 * `frameHosts` opens in an iframe, and `next.config.js` allows exactly those hosts in `frame-src`.
 * Any other https host opens in a new tab. Anything else returns null and the gallery shows
 * nothing.
 */
export function resolveTourEntry(raw: string | null | undefined): TourEntry | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  // The CSP source has no port, so a custom port cannot be framed.
  const defaultPort = url.port === '';
  const frameable =
    defaultPort && (tourHosts.frameHosts as string[]).includes(url.hostname.toLowerCase());
  return { href: url.href, mode: frameable ? 'frame' : 'tab' };
}
