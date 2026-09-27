import { isAddressSegment, isCitySegment } from '@cribstop/property-contracts';

/**
 * True when a `/<city>/[...rest]` catch-all path is a property page: `<city>-<st>/<address-slug>`.
 *
 * The first segment is always `<city>-<st>` (shared with the search routes #350 adds under the
 * same prefix). A second segment that starts with a digit is an address slug; any other second
 * segment (`homes-for-sale`, `homes-for-rent`) — or any segment count other than exactly two — is
 * a search shape, which #350 owns. This route 404s on those for now.
 *
 * Next.js matches a static route (`/about`, `/search`, `/login`, ...) before a dynamic segment at
 * the same level regardless of nesting, so this catch-all never intercepts them.
 */
export function isPropertyPath(city: string, rest: readonly string[]): rest is readonly [string] {
  return isCitySegment(city) && rest.length === 1 && isAddressSegment(rest[0] as string);
}
