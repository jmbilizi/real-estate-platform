import { permanentRedirect } from 'next/navigation';
import { groupedSearchHref, parseNeighborhoodsScope } from '@/lib/neighborhoods';

/**
 * Old standalone page (#493). The grouped search replaced it (#504), so this URL sends a 308 to
 * that view with the same `state` and `city`. A `state` that is not licensed gives the default scope.
 */
export default async function NeighborhoodsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  permanentRedirect(groupedSearchHref(parseNeighborhoodsScope(await searchParams)));
}
