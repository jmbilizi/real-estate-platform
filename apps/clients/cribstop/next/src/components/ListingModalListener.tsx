'use client';

import { useSearchParams } from 'next/navigation';
import ListingDetailModal from './ListingDetailModal';

export default function ListingModalListener() {
  const searchParams = useSearchParams();
  const listingId = searchParams.get('listing');

  if (!listingId) return null;

  return <ListingDetailModal id={listingId} />;
}
