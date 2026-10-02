import type { SearchListingType } from '@/lib/store/slices/searchSlice';

/** The closed-state summary of the listing type. The search bar and the mobile pill share it. */
export const LISTING_TYPE_SUMMARY_LABELS: Record<SearchListingType, string> = {
  all: 'All listings',
  sale: 'For Sale',
  rent: 'For Rent',
  sold: 'Sold',
};
