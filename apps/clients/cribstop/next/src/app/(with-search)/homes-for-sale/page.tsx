import type { Metadata } from 'next';
import SearchPathView, { searchPathMetadata } from '@/components/SearchPathView';
import { toSearchParams } from '@/lib/search-route';

/** The map-area search path (#350): `/homes-for-sale?boundary=...` or `?bounds=<n,e,s,w>`. */

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const parsed = { place: null, segment: 'homes-for-sale' } as const;
  return searchPathMetadata(parsed, toSearchParams(await searchParams));
}

export default async function HomesForSalePage({ searchParams }: Props) {
  const parsed = { place: null, segment: 'homes-for-sale' } as const;
  return <SearchPathView parsed={parsed} params={toSearchParams(await searchParams)} />;
}
