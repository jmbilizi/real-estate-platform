'use client';

import { useRouter } from 'next/navigation';
import ListingModalFrame from '@/components/listing/ListingModalFrame';
import ListingSearchBackdrop from '@/components/listing/ListingSearchBackdrop';
import { ListingErrorPanel } from '@/components/listing/ListingStates';

/**
 * A directly loaded property page whose server read failed (#907). It keeps the modal chrome the
 * loading state showed, so the page does not swap a modal for a bare box. "Try again" re-runs the
 * server read.
 */
export default function ListingLoadError({ message }: { message: string }) {
  const router = useRouter();
  const close = () => router.push('/homes-for-sale?type=all');
  return (
    <>
      <ListingSearchBackdrop />
      <ListingModalFrame onClose={close}>
        <ListingErrorPanel message={message} onRetry={() => router.refresh()} onClose={close} />
      </ListingModalFrame>
    </>
  );
}
