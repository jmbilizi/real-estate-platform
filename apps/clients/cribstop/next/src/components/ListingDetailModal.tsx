'use client';

import { useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import listings from '@/lib/listings';
import Modal from './Modal';
import ListingDetailContent from './ListingDetailContent';

export default function ListingDetailModal({ id }: { id: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(true);
  const listing = listings.find((l) => l.id === id);

  const handleClose = () => {
    setOpen(false);
    const params = new URLSearchParams(searchParams.toString());
    params.delete('listing');
    const url = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    setTimeout(() => router.replace(url), 310);
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      mobileStyle="full-screen"
      widthClass="sm:max-w-7xl"
      heightClass="sm:h-screen"
      noPadding
      squareBottom
      noScroll
    >
      {listing ? (
        <ListingDetailContent listing={listing} onClose={handleClose} />
      ) : (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <p className="text-5xl">🏠</p>
          <h1 className="mt-4 font-display text-2xl font-bold">Listing not found</h1>
          <a href="/search" className="btn-primary mt-4">
            Browse all homes
          </a>
        </div>
      )}
    </Modal>
  );
}
