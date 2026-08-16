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

export type NavTab = 'homes' | 'services' | 'connect';
export type ListingType = 'sale' | 'rent';

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

/**
 * The search bar's panel identities — the single source of truth for which segments exist, shared
 * by the `activePanel` state, the pill's open-a-panel handler, and the panel-cycling chain in the
 * mobile sheet.
 *
 * There is deliberately no `'who'` member. The occupancy picker that used to live behind it
 * collected age bands, a children/infants count and a "service animal" flag — familial status, age,
 * family responsibilities and disability, four protected classes, on a housing search. It was
 * removed in full per the stakeholder decision recorded on #34 (Option 1, 2026-08-13). Because the
 * union is the type of `activePanel`, adding the segment back cannot be done quietly: every render
 * path, keyboard path and panel transition that could target it fails to compile.
 */
export const SEARCH_PANELS = ['where', 'when', 'what'] as const;
export type SearchPanel = (typeof SEARCH_PANELS)[number];

/**
 * A parcel listing has no dwelling: `beds`, `baths` and `sqft` are legitimately NULL on it, so a
 * dwelling predicate (`beds >= 2`) excludes every parcel server-side. Asking the API for land AND
 * two bedrooms is therefore a guaranteed empty result set with nothing on screen to explain it —
 * the trap #24 exists to close. The UI's job is to clear and disable those controls, never to
 * quietly drop the filter from the request: the API is meant to receive exactly what was asked.
 *
 * Two labels, one meaning: `'Land'` is the wire-contract value (`PROPERTY_TYPES` in
 * `@cribstop/property-contracts`), `'Lot/Land'` is the older chip label still used by the search
 * bar and the filter modal. Both are recognised so the interlock cannot be defeated by whichever
 * vocabulary a surface happens to be on.
 */
export const PARCEL_PROPERTY_TYPES = ['Land', 'Lot/Land'] as const;

/** Visible, factual explanation for the controls the parcel interlock disables. */
export const PARCEL_INTERLOCK_HINT =
  'Land parcels have no bedrooms, bathrooms or living area, so these filters do not apply.';

/**
 * True when a parcel type is the *only* thing selected. A mixed selection (land + condo) leaves the
 * dwelling controls alone, because those listings can satisfy them.
 */
export function isParcelOnlySelection(
  selected: readonly (string | null | undefined)[] | string | null | undefined,
): boolean {
  const values = (
    typeof selected === 'string' ? [selected] : Array.isArray(selected) ? selected : []
  ).filter((value): value is string => !!value && value !== 'all');
  return (
    values.length > 0 &&
    values.every((value) => (PARCEL_PROPERTY_TYPES as readonly string[]).includes(value))
  );
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
