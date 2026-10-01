import type { Metadata } from 'next';
import NeighborhoodsView from '@/components/NeighborhoodsView';
import ScrollSentinel from '@/components/ScrollSentinel';
import { loadNeighborhoodSections } from '@/lib/api/neighborhoods-server';
import { neighborhoodsMetadata, parseNeighborhoodsScope } from '@/lib/neighborhoods';
import { publishableOrigin } from '@/lib/publishable-origin';

/**
 * `/neighborhoods` (#493): every neighborhood by state, as server-rendered HTML. The scope comes
 * from the URL only (`?state=XX`, `?state=XX&city=Name`). A static route, so `[city]` never sees it.
 */

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  return neighborhoodsMetadata(parseNeighborhoodsScope(await searchParams), publishableOrigin());
}

export default async function NeighborhoodsPage({ searchParams }: Props) {
  const scope = parseNeighborhoodsScope(await searchParams);
  const sections = await loadNeighborhoodSections(scope);
  return (
    <>
      <ScrollSentinel />
      <NeighborhoodsView sections={sections} />
    </>
  );
}
