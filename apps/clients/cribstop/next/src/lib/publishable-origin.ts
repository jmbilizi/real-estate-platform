/**
 * The origin to publish in a canonical link or `og:url`, or null when we have none to vouch for.
 *
 * Only `SITE_ORIGIN` counts. A request's `Host` / `X-Forwarded-Host` is client-controlled and this
 * app's ingress rule is a catch-all, so trusting it would let a crafted header publish a real
 * listing's canonical URL on an attacker's domain — to the one audience that acts on it, a
 * crawler. The deploy action sets `SITE_ORIGIN` from `CRIBSTOP_DOMAIN`. A local deploy leaves it
 * unset, so this returns null.
 *
 * Shared by every route that builds listing metadata (`listing/[id]`, the `[city]` property page)
 * so the rule has one implementation.
 */
export function publishableOrigin(): string | null {
  const configured = process.env.SITE_ORIGIN?.trim();
  return configured ? configured.replace(/\/$/, '') : null;
}
