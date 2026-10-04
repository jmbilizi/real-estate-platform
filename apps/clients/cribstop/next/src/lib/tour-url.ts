import tourHosts from './tour-hosts.json';

/**
 * `href` always opens in a new tab. `embedSrc` is set only when `mode` is `frame`, and it can
 * differ from `href` when the host serves a separate embed URL.
 */
export type TourEntry = { href: string; mode: 'frame' | 'tab'; embedSrc: string | null };

const YOUTUBE_ID = /^[\w-]{11}$/;
const VIMEO_ID = /^\d{6,12}$/;
const VIMEO_HASH = /^[a-f0-9]{8,12}$/i;
const MATTERPORT_ID = /^[A-Za-z0-9]{11}$/;

/** A listed host `*.example.com` covers every subdomain and not `example.com` itself. */
export function hostIsFrameable(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (tourHosts.frameHosts as string[]).some((entry) =>
    entry.startsWith('*.') ? host.endsWith(entry.slice(1)) : host === entry,
  );
}

/**
 * Maps a page URL to the URL the host built for iframes, or returns null. These pages send
 * `X-Frame-Options: SAMEORIGIN`: YouTube and Vimeo watch pages, and Matterport Discover.
 */
function toEmbedUrl(url: URL): URL | null {
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '');
  const parts = url.pathname.split('/').filter(Boolean);

  if (host === 'youtu.be' || host === 'youtube.com' || host === 'youtube-nocookie.com') {
    let id: string | undefined;
    if (host === 'youtu.be') id = parts[0];
    else if (url.pathname === '/watch') id = url.searchParams.get('v') ?? undefined;
    else if (['embed', 'shorts', 'live'].includes(parts[0])) id = parts[1];
    return id && YOUTUBE_ID.test(id)
      ? new URL(`https://www.youtube-nocookie.com/embed/${id}`)
      : null;
  }

  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const player = host === 'player.vimeo.com';
    if (player && parts[0] !== 'video') return null;
    const id = player ? parts[1] : parts[0];
    const hash = player ? url.searchParams.get('h') : parts[1];
    if (!id || !VIMEO_ID.test(id)) return null;
    const embed = new URL(`https://player.vimeo.com/video/${id}`);
    if (hash && VIMEO_HASH.test(hash)) embed.searchParams.set('h', hash);
    return embed;
  }

  if (host === 'matterport.com' || host === 'discover.matterport.com') {
    const id = host === 'matterport.com' ? parts[2] : parts[1];
    const isSpace =
      host === 'matterport.com'
        ? parts[0] === 'discover' && parts[1] === 'space'
        : parts[0] === 'space';
    return isSpace && id && MATTERPORT_ID.test(id)
      ? new URL(`https://my.matterport.com/show/?m=${id}`)
      : null;
  }

  return null;
}

/**
 * Decides how the gallery shows a listing's virtual tour (#573, #590).
 *
 * The URL is unvalidated MLS text, so only `https:` without credentials passes. The URL, or its
 * embed form from `toEmbedUrl`, plays in the gallery when its host is in `tour-hosts.json`.
 * `next.config.js` allows exactly those hosts in `frame-src`. Any other https URL opens in a new
 * tab. Anything else returns null and the gallery shows nothing.
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
  const candidate = toEmbedUrl(url) ?? url;
  // The CSP source has no port, so a custom port cannot be framed.
  const frameable = candidate.port === '' && hostIsFrameable(candidate.hostname);
  return {
    href: url.href,
    mode: frameable ? 'frame' : 'tab',
    embedSrc: frameable ? candidate.href : null,
  };
}
