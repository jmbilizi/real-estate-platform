import { permanentRedirect } from 'next/navigation';
import { legacySearchUrl } from '@/lib/search-place';
import { toSearchParams } from '@/lib/search-route';

/**
 * Legacy search URL. `/search?...` sends a 308 to the place path (#350), so old links keep
 * working. See `legacySearchUrl` for the mapping.
 */
export default async function LegacySearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  permanentRedirect(legacySearchUrl(toSearchParams(await searchParams)));
}
