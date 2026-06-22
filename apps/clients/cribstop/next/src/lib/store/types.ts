export interface User {
  name: string;
  email: string;
  avatar?: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  bio?: string;
  dateOfBirth?: string;
  emailNotificationsEnabled?: boolean;
  smsNotificationsEnabled?: boolean;
  pushNotificationsEnabled?: boolean;
  marketingOptIn?: boolean;
  profileComplete?: boolean;
}

/** Returns best display name: "First Last" > displayName > email */
export function getUserDisplayName(user: User | null): string {
  if (!user) return '';
  if (user.firstName || user.lastName) {
    return [user.firstName, user.lastName].filter(Boolean).join(' ');
  }
  return user.displayName || user.email;
}

/** Returns initials from display name or email */
export function getUserInitials(user: User | null): string {
  if (!user) return '';
  if (user.firstName) {
    return (user.firstName[0] + (user.lastName?.[0] || '')).toUpperCase();
  }
  return user.email[0].toUpperCase();
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
