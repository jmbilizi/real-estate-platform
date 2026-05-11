'use client';

import CompactSearchBar from './CompactSearchBar';

export default function MobileSearchSheet({ onClose }: { onClose: () => void }) {
  return <CompactSearchBar mobileSheetMode onClose={onClose} />;
}
