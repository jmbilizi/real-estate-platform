import { isAddressSegment, isCitySegment } from '@cribstop/property-contracts';

/**
 * True when a `/<city>/[...rest]` catch-all path is a property page: `<city>-<st>/<address-slug>`.
 *
 * The first segment is always `<city>-<st>`. A second segment that starts with a digit is an
 * address slug. Every other shape is a search path if `parseSearchPath` accepts it (#350).
 *
 * Next.js matches a static route (`/about`, `/search`, `/homes-for-sale`, ...) before a dynamic segment at
 * the same level regardless of nesting, so this catch-all never intercepts them.
 */
export function isPropertyPath(city: string, rest: readonly string[]): rest is readonly [string] {
  return isCitySegment(city) && rest.length === 1 && isAddressSegment(rest[0] as string);
}
