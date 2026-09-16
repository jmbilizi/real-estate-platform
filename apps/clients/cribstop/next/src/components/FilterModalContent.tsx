import React from 'react';
import { AMENITIES, LISTING_TYPES, PROPERTY_TYPES } from '@cribstop/property-contracts';
import type { Amenity, PropertyType, SearchFilters } from '@/lib/types';
import { isLandOnly } from '@/lib/listing-filters';
import { PARCEL_INTERLOCK_HINT } from '@/lib/store/types';

/** Ties the disabled dwelling controls to their single visible explanation. */
const PARCEL_HINT_ID = 'filter-modal-parcel-interlock-hint';

/**
 * The filter modal's body: one control per parameter the listings contract defines, and nothing
 * else.
 *
 * **Controlled, with no state of its own.** It used to keep a full Zillow-shaped filter set in
 * local `useState` and hand it to an `onShow` callback the parent wired to `onClose` — a
 * `() => void` — so every value it collected was dropped on the floor. The modal closed, the URL
 * did not change, and the results were never narrowed. Owning no state is what makes that class of
 * bug unrepresentable here: the only filter set is the parent's draft, and the only way to change
 * it is `onChange`.
 *
 * The vocabulary is the contract's, imported from `@cribstop/property-contracts` rather than
 * re-typed. Every control that had no contract parameter behind it is gone — see the note on
 * `FilterModal` for the list. A control that pretends to filter is worse than an absent one,
 * because the user believes the results in front of them are narrowed.
 */
export interface FilterModalContentProps {
  /** The draft filter set being edited. Not the applied one — the parent commits on Show. */
  value: SearchFilters;
  onChange: (next: SearchFilters) => void;
}

/** Icons are decorative; the label is the accessible name. */
const PROPERTY_TYPE_ICONS: Record<PropertyType, string> = {
  'Single Family': '🏠',
  Condo: '🏢',
  Townhome: '🏘️',
  'Multi-Family': '🏡',
  Loft: '🏬',
  Land: '🌳',
  'New Construction': '🏗️',
};

const LISTING_TYPE_LABELS: Record<(typeof LISTING_TYPES)[number] | 'all', string> = {
  all: 'All',
  sale: 'Buy',
  rent: 'Rent',
  sold: 'Sold',
};

/** The stepper's rungs: `0` reads as "Any" and is sent as no filter at all. */
const COUNT_MIN = 0;
const COUNT_MAX = 8;

export default function FilterModalContent({ value, onChange }: FilterModalContentProps) {
  const set = (patch: SearchFilters) => onChange({ ...value, ...patch });

  /*
   * The Lot/Land interlock (#24), unchanged in meaning.
   *
   * A parcel has no bedrooms, bathrooms or living area, so the API's dwelling predicates exclude
   * every parcel: asking for Land AND 2+ beds is a guaranteed empty page with nothing on screen to
   * explain it. The dwelling controls are cleared *and* disabled while land is the only home type
   * selected, with a visible hint tied to them by `aria-describedby`.
   *
   * The clearing happens in the parent's draft reducer (`applyLandInterlock`), so it converges in
   * one pass with no effect and no render loop, and it clears the *values* rather than dropping
   * them from the request — the API is meant to receive exactly what the UI shows.
   */
  const parcelOnly = isLandOnly(value);
  const parcelHintId = parcelOnly ? PARCEL_HINT_ID : undefined;

  const toggleAmenity = (amenity: Amenity) => {
    const current = value.amenities ?? [];
    const next = current.includes(amenity)
      ? current.filter((entry) => entry !== amenity)
      : [...current, amenity];
    set({ amenities: next.length > 0 ? next : undefined });
  };

  const priceInput = (
    key: 'minPrice' | 'maxPrice',
    label: string,
    placeholder: string,
    inputId: string,
  ) => (
    <div>
      <label className="mb-1 block text-xs font-medium text-ink-muted" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        type="number"
        min={0}
        step={1}
        inputMode="numeric"
        placeholder={placeholder}
        className="w-full rounded-xl border border-surface-border px-3 py-2 text-sm font-normal"
        value={value[key] ?? ''}
        onChange={(event) => set({ [key]: wholeNumberOrUndefined(event.target.value) })}
      />
    </div>
  );

  const stepper = (key: 'beds' | 'baths', label: string, disabled: boolean) => {
    const current = value[key] ?? COUNT_MIN;
    /*
     * Stepping is defined on the value, not on an index into a rung list, because a URL can carry
     * a value that is not a rung: `?baths=2.5` is a legitimate contract value (the service's
     * `baths_display` is `full + 0.5 * half`), and `?beds=12` is reachable by hand.
     *
     * Going up floors first and going down ceils first, so the next rung is always the adjacent
     * one in the direction pressed. Truncating in both directions — which an earlier version did —
     * turned "–" from 2.5 into 1, silently skipping a whole bedroom.
     */
    const step = (delta: number) => {
      const from = delta > 0 ? Math.floor(current) : Math.ceil(current);
      const next = Math.min(COUNT_MAX, Math.max(COUNT_MIN, from + delta));
      set({ [key]: next === COUNT_MIN ? undefined : next });
    };

    return (
      <div className="flex items-center justify-between py-1">
        <span className={`text-sm font-medium ${disabled ? 'text-ink-subtle' : 'text-ink'}`}>
          {label}
        </span>
        <div className="flex items-center gap-5">
          {stepperButton({
            label: '–',
            accessibleName: `Fewer ${label.toLowerCase()}`,
            disabled: disabled || current <= COUNT_MIN,
            describedBy: parcelHintId,
            onClick: () => step(-1),
          })}
          <span
            aria-live="polite"
            className={`w-10 text-center text-[15px] font-normal ${
              disabled ? 'text-ink-subtle' : 'text-ink'
            }`}
          >
            {disabled || current <= COUNT_MIN ? 'Any' : `${current}+`}
          </span>
          {stepperButton({
            label: '+',
            accessibleName: `More ${label.toLowerCase()}`,
            disabled: disabled || current >= COUNT_MAX,
            describedBy: parcelHintId,
            onClick: () => step(1),
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 gap-y-6">
      {/* ── Listing type ─────────────────────────────────────────────── */}
      <fieldset>
        <legend className="mb-2 font-semibold uppercase text-xs tracking-wider text-ink">
          Listing Type
        </legend>
        <div className="inline-flex w-full rounded-full bg-surface-alt p-1">
          {(['all', ...LISTING_TYPES] as const).map((option) => {
            const active = (value.listingType ?? 'all') === option;
            return (
              <button
                key={option}
                type="button"
                aria-pressed={active}
                onClick={() => set({ listingType: option === 'all' ? undefined : option })}
                className={`flex-1 rounded-full px-3 py-1.5 text-sm font-semibold transition ${
                  active ? 'bg-white text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
                }`}
              >
                {LISTING_TYPE_LABELS[option]}
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* ── Home type ────────────────────────────────────────────────────
          Single-select, because the contract's `propertyType` is one enum value. The old grid was
          multi-select and produced `propertyType=Condo,Townhome`, which the API rejects. */}
      <fieldset>
        <legend className="mb-2 font-semibold uppercase text-xs tracking-wider text-ink">
          Home Type
        </legend>
        <div className="grid grid-cols-4 gap-2">
          {PROPERTY_TYPES.map((type) => {
            const active = value.propertyType === type;
            return (
              <button
                key={type}
                type="button"
                aria-pressed={active}
                onClick={() => set({ propertyType: active ? undefined : type })}
                className={`flex flex-col items-center rounded-xl border px-1 py-3 text-[11px] font-normal transition ${
                  active
                    ? 'bg-ink text-white border-ink'
                    : 'bg-white text-ink border-surface-border hover:bg-surface-alt'
                }`}
              >
                <span className="text-xl mb-0.5" aria-hidden="true">
                  {PROPERTY_TYPE_ICONS[type]}
                </span>
                {type}
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* ── Price ────────────────────────────────────────────────────── */}
      <fieldset>
        <legend className="mb-2 font-semibold uppercase text-xs tracking-wider text-ink">
          Price Range
        </legend>
        <div className="grid grid-cols-2 gap-3">
          {priceInput('minPrice', 'Min price', 'No min', 'filter-min-price')}
          {priceInput('maxPrice', 'Max price', 'No max', 'filter-max-price')}
        </div>
      </fieldset>

      {/* ── Beds / Baths / Min sqft — the dwelling group the interlock governs ── */}
      <fieldset>
        <legend className="mb-2 font-semibold uppercase text-xs tracking-wider text-ink">
          Size
        </legend>
        {parcelOnly && (
          <p id={PARCEL_HINT_ID} className="mb-3 text-xs text-ink-muted">
            {PARCEL_INTERLOCK_HINT}
          </p>
        )}
        <div className="flex flex-col gap-3">
          {stepper('beds', 'Bedrooms', parcelOnly)}
          {stepper('baths', 'Bathrooms', parcelOnly)}
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-muted" htmlFor="filter-sqft">
              Min square feet
            </label>
            <input
              id="filter-sqft"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              placeholder={parcelOnly ? 'Not applicable to land' : 'No min'}
              disabled={parcelOnly}
              aria-describedby={parcelHintId}
              className="w-full rounded-xl border border-surface-border px-3 py-2 text-sm font-normal disabled:bg-surface-alt disabled:text-ink-subtle disabled:cursor-not-allowed"
              value={parcelOnly ? '' : (value.minSqft ?? '')}
              onChange={(event) => set({ minSqft: wholeNumberOrUndefined(event.target.value) })}
            />
          </div>
        </div>
      </fieldset>

      {/* ── Showing-only toggles ─────────────────────────────────────────
          `openHouse` and `newConstruction` are the only two booleans with a predicate of their own.
          `waterfront` and `petFriendly` are not here because server-side they *are* the amenities
          of the same name (see `parseFiltersFromSearchParams`), so they appear once, as chips. */}
      <fieldset>
        <legend className="mb-2 font-semibold uppercase text-xs tracking-wider text-ink">
          Show Only
        </legend>
        <div className="flex flex-wrap gap-2">
          {(
            [
              { key: 'openHouse', label: 'Has an open house' },
              { key: 'newConstruction', label: 'Newly built' },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              type="button"
              aria-pressed={!!value[key]}
              onClick={() => set({ [key]: value[key] ? undefined : true })}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                value[key]
                  ? 'border-ink bg-ink text-white'
                  : 'border-surface-border text-ink-muted hover:border-ink-subtle'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      {/* ── Amenities — the contract's closed 15-value set ───────────── */}
      <fieldset>
        <legend className="mb-2 font-semibold uppercase text-xs tracking-wider text-ink">
          Amenities
        </legend>
        <div className="flex flex-wrap gap-2">
          {AMENITIES.map((amenity) => {
            const active = value.amenities?.includes(amenity) ?? false;
            return (
              <button
                key={amenity}
                type="button"
                aria-pressed={active}
                onClick={() => toggleAmenity(amenity)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  active
                    ? 'border-ink bg-ink text-white'
                    : 'border-surface-border text-ink-muted hover:border-ink-subtle'
                }`}
              >
                {amenity}
              </button>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}

function stepperButton({
  label,
  accessibleName,
  disabled,
  describedBy,
  onClick,
}: {
  label: string;
  accessibleName: string;
  disabled: boolean;
  describedBy?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-disabled={disabled}
      aria-label={accessibleName}
      aria-describedby={describedBy}
      onClick={onClick}
      className={`h-8 w-8 rounded-full border inline-flex items-center justify-center leading-none select-none transition-colors ${
        disabled
          ? 'border-[rgba(0,0,0,0.12)] text-[rgba(0,0,0,0.2)] cursor-default'
          : 'border-[rgba(0,0,0,0.4)] text-ink hover:border-ink cursor-pointer'
      }`}
      style={{ fontSize: '18px', paddingBottom: label === '–' ? '1px' : '0' }}
    >
      <span aria-hidden="true">{label}</span>
    </button>
  );
}

/**
 * A number input can hold `''`, `-4`, `1.5` or `1e9`. The contract's numeric query parameters are
 * `^\d+$`, so anything else is a 400 we would have manufactured ourselves — parse to the filter's
 * absence instead, which degrades to a wider search the user can act on.
 */
function wholeNumberOrUndefined(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  // `0` is the filter's absence, not a filter — matching the parser and the stepper's "Any" rung.
  // A `minSqft` of 0 is in fact a narrowing (`sqft >= 0` excludes every parcel, whose `sqft` is
  // NULL) that would show as no active filter and leave nothing on the page able to clear it.
  return Number(trimmed) || undefined;
}
