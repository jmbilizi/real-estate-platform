import type { Metadata } from 'next';
import SearchPathView, { searchPathMetadata } from '@/components/SearchPathView';
import { toSearchParams } from '@/lib/search-route';

/** The map-area rental search path (#350). See `homes-for-sale/page.tsx`. */

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const parsed = { place: null, segment: 'homes-for-rent' } as const;
  return searchPathMetadata(parsed, toSearchParams(await searchParams));
}

export default async function HomesForRentPage({ searchParams }: Props) {
  const parsed = { place: null, segment: 'homes-for-rent' } as const;
  return <SearchPathView parsed={parsed} params={toSearchParams(await searchParams)} />;
}
