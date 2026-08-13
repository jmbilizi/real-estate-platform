import { Suspense } from 'react';
import ListingDetailModal from '@/components/ListingDetailModal';
import { ListingDetailSkeleton } from '@/components/listing/ListingStates';

/**
 * `ListingDetailModal` reads `useSearchParams()` (to preserve the rest of the query string when it
 * closes), so it needs a Suspense boundary the same way the auth modals do. The fallback is the
 * detail skeleton rather than `null`: this route is reached by a real navigation to a listing, so
 * there is something worth showing while it resolves.
 */
export default async function ListingModalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<ListingDetailSkeleton />}>
      <ListingDetailModal id={id} />
    </Suspense>
  );
}
