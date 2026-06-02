export interface User {
  name: string;
  email: string;
  avatar?: string;
}

export type ListingTab = 'for-sale' | 'for-rent';

export type SearchDateFlexibility =
  | 'exact'
  | '1'
  | '3'
  | '7'
  | '14'
  | '30'
  | '60'
  | '90'
  | '180'
  | '365'
  | '730';

export interface SearchDateRange {
  start: string;
  end: string;
  flexibility: SearchDateFlexibility;
}

export interface SearchOccupants {
  adults: number;
  seniors: number;
  teens: number;
  children: number;
  infants: number;
  pets: number;
}

export type SearchSuggestion = any | null;
