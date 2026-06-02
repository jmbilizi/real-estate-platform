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

export interface SearchSuggestionValue {
  display_name?: string;
  lat: string;
  lon: string;
  type?: string;
  address?: Record<string, string | undefined>;
  [key: string]: unknown;
}

export type SearchSuggestion = SearchSuggestionValue | null;
