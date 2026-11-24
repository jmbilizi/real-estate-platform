import React, { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Building,
  Building2,
  Caravan,
  Construction,
  Factory,
  House,
  Minus,
  Plus,
  Trees,
  Warehouse,
} from 'lucide-react';
import {
  AMENITIES,
  DEFAULT_STATUS_FILTER,
  isDefaultStatusFilter,
  PROPERTY_TYPES,
  STATUS_FILTER_VALUES,
} from '@cribstop/property-contracts';
import type { Amenity, PropertyType, SearchFilters, StatusFilter } from '@/lib/types';
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

/** `Pending` is the merged consumer status (migration `1785801600003_create-listings.js`); it
 *  reads to a shopper as "Under Contract", not the RESO field name. */
const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  Active: 'Active',
  'Coming Soon': 'Coming Soon',
  Pending: 'Under Contract',
};

/** Line icons, the same set as the header. Decorative: the label is the accessible name. */
const PROPERTY_TYPE_ICONS: Record<PropertyType, LucideIcon> = {
  'Single Family': House,
  Condo: Building2,
  Townhome: Warehouse,
  'Multi-Family': Building,
  Loft: Factory,
  Land: Trees,
  'New Construction': Construction,
  'Manufactured/Mobile': Caravan,
};

/*
 * One look for the whole panel. A selected control is the brand color on a brand tint, never a
 * black fill. `brand-700` on `brand-50` passes 4.5:1 for text.
 */
// On a wrapper `div`, never on the `fieldset`: a legend sits on its fieldset's top border, and
// fieldset padding starts below the legend. Both put the title on the divider line.
const SECTION_CLASSES = 'py-6 first:pt-0 last:pb-0';
const SECTION_TITLE_CLASSES = 'text-base font-semibold text-ink';
const FOCUS_RING_CLASSES =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1';
const SELECTED_CLASSES = 'border-brand bg-brand-50 text-brand-700';
const UNSELECTED_CLASSES = 'border-surface-border bg-white text-ink hover:border-ink';
const CHIP_CLASSES = `inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors ${FOCUS_RING_CLASSES}`;
const chipClasses = (active: boolean) =>
  `${CHIP_CLASSES} ${active ? SELECTED_CLASSES : UNSELECTED_CLASSES}`;
const FIELD_CLASSES =
  'h-11 w-32 rounded-full border bg-white px-3 text-center text-[15px] text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-2';

/** The stepper's rungs: `0` reads as "Any" and is sent as no filter at all. */
const COUNT_MIN = 0;
const COUNT_MAX = 8;

/** The max-price stepper's rung size (#243). */
const MAX_PRICE_STEP = 25_000;

/**
 * Strips the formatting a user would naturally type or paste (`$`, thousands commas, spaces) and
 * reports whether what remains is a valid whole number.
 *
 * Formatting characters are not "junk" — stripping them silently is what a currency field is
 * supposed to do. Anything else left over (a letter, a decimal point, a minus sign) is junk: it
 * would fail the contract's `maxPrice` pattern (`^\d+$`), so it is flagged rather than forwarded.
 */
function sanitizeMaxPriceInput(raw: string): { digits: string; invalid: boolean } {
  const stripped = raw.replace(/[$,\s]/g, '');
  if (stripped === '') return { digits: '', invalid: false };
  return { digits: stripped, invalid: !/^\d+$/.test(stripped) };
}

/**
 * One row label style for every filter row (Bedrooms, Bathrooms, Price, Square Feet), so a reader
 * cannot tell which control it sits next to from its typography alone.
 *
 * Renders a `<label>` when the row's control is a single focusable element with an `id` (Price,
 * Square Feet), so the visible text stays its programmatic label. Bedrooms/Bathrooms have no such
 * element — each is a pair of buttons plus a live-region span — so those stay a `<span>`; the
 * buttons carry their own `aria-label`.
 */
function rowLabel(
  text: string,
  { htmlFor, disabled, title }: { htmlFor?: string; disabled?: boolean; title?: boolean },
) {
  // `title`: the row is a section of its own (Price), so its label has the section title look.
  const className = title
    ? SECTION_TITLE_CLASSES
    : `text-[15px] ${disabled ? 'text-ink-subtle' : 'text-ink'}`;
  return htmlFor ? (
    <label htmlFor={htmlFor} className={className}>
      {text}
    </label>
  ) : (
    <span className={className}>{text}</span>
  );
}

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

  /**
   * Toggles one status chip. The draft is cleared back to `undefined` — never written as the
   * default set spelled out explicitly — the moment it matches `DEFAULT_STATUS_FILTER`, so a user
   * who ticks every box back on lands on exactly the state they started from: no `status` in the
   * URL, no badge count, same as never having touched this filter.
   */
  const toggleStatus = (status: StatusFilter) => {
    const current = value.status ?? DEFAULT_STATUS_FILTER;
    const removing = current.includes(status);
    // Never let the last chip come off. An empty `status` writes no URL param at all
    // (`filtersToSearchParams`), so the contract's own default would apply underneath a modal
    // that shows nothing selected — a UI lying about what it is about to search for.
    if (removing && current.length === 1) return;
    const next = removing ? current.filter((entry) => entry !== status) : [...current, status];
    set({
      status: isDefaultStatusFilter(next) ? undefined : (next as StatusFilter[]),
    });
  };

  const toggleAmenity = (amenity: Amenity) => {
    const current = value.amenities ?? [];
    const next = current.includes(amenity)
      ? current.filter((entry) => entry !== amenity)
      : [...current, amenity];
    set({ amenities: next.length > 0 ? next : undefined });
  };

  /*
   * The max-price control's own draft (#243): a "−"/"+" stepper flanking a typable input,
   * matching the visual style the "What" search bar panel used for this control before it moved
   * here.
   *
   * The input holds a local draft rather than `value.maxPrice` directly, so a keystroke never
   * fires a request — only blur or Enter commits it (`commitMaxPrice`), and only when it is not
   * mid-error. Resyncing from `value.maxPrice` (not from `maxPriceText`) is what lets an external
   * change — "Clear all", or the modal reopening with a different applied value — update the field
   * without stomping on text the user is still typing.
   */
  const [maxPriceText, setMaxPriceText] = useState(() =>
    value.maxPrice !== undefined ? String(value.maxPrice) : '',
  );
  const [maxPriceError, setMaxPriceError] = useState(false);

  useEffect(() => {
    setMaxPriceText(value.maxPrice !== undefined ? String(value.maxPrice) : '');
    setMaxPriceError(false);
  }, [value.maxPrice]);

  const handleMaxPriceChange = (raw: string) => {
    const { digits, invalid } = sanitizeMaxPriceInput(raw);
    setMaxPriceText(digits);
    setMaxPriceError(invalid);
  };

  /** Never emits a value `searchRequestSchema` would reject, and never emits `0` — a `maxPrice`
   *  of zero returns nothing, which reads as a broken search rather than "no maximum". */
  const commitMaxPrice = () => {
    if (maxPriceError) return; // the error message stays up until the user fixes it
    const trimmed = maxPriceText.trim();
    if (trimmed === '') {
      set({ maxPrice: undefined });
      return;
    }
    const parsed = Number(trimmed);
    set({ maxPrice: parsed === 0 ? undefined : parsed });
  };

  /**
   * Steps by `MAX_PRICE_STEP` from whatever the user would see committed right now — the pending
   * typed draft when it is valid, the last applied value otherwise. This is what lets a value
   * typed off the 25,000 grid (say 460,000) still step by exactly 25,000 from that value, rather
   * than snapping to the nearest rung and discarding what was typed.
   */
  const stepMaxPrice = (delta: number) => {
    const base =
      !maxPriceError && maxPriceText.trim() !== ''
        ? Number(maxPriceText.trim())
        : (value.maxPrice ?? 0);
    const next = Math.max(0, base + delta);
    const committed = next === 0 ? undefined : next;
    set({ maxPrice: committed });
    setMaxPriceText(committed !== undefined ? String(committed) : '');
    setMaxPriceError(false);
  };

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
      <div className="flex flex-wrap items-center justify-between gap-y-2">
        {rowLabel(label, { disabled })}
        <div className="flex items-center gap-1">
          {stepperButton({
            label: '–',
            accessibleName: `Fewer ${label.toLowerCase()}`,
            disabled: disabled || current <= COUNT_MIN,
            describedBy: parcelHintId,
            onClick: () => step(-1),
          })}
          <span
            aria-live="polite"
            className={`w-12 text-center text-[15px] font-medium ${
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
    <div className="divide-y divide-surface-border">
      {/* ── Home type ── Multi-select. A listing matches any selected type. */}
      <div className={SECTION_CLASSES}>
        <fieldset>
          <legend className={`mb-3 ${SECTION_TITLE_CLASSES}`}>Home Type</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {PROPERTY_TYPES.map((type) => {
              const selected = value.propertyType ?? [];
              const active = selected.includes(type);
              const next = active ? selected.filter((t) => t !== type) : [...selected, type];
              const Icon = PROPERTY_TYPE_ICONS[type];
              return (
                <button
                  key={type}
                  type="button"
                  aria-pressed={active}
                  onClick={() => set({ propertyType: next.length > 0 ? next : undefined })}
                  className={`flex min-h-[76px] flex-col items-start justify-between gap-2 rounded-md border p-3 text-left text-[13px] font-medium leading-tight transition-colors ${FOCUS_RING_CLASSES} ${
                    active ? `${SELECTED_CLASSES} ring-1 ring-inset ring-brand` : UNSELECTED_CLASSES
                  }`}
                >
                  <Icon
                    className="h-6 w-6 shrink-0"
                    strokeWidth={active ? 2 : 1.75}
                    aria-hidden="true"
                  />
                  {type}
                </button>
              );
            })}
          </div>
        </fieldset>
      </div>

      {/* ── Listing status ── Multi-select, matching Home Type's chip style. Defaults to
           `DEFAULT_STATUS_FILTER` (Active, Coming Soon) when `value.status` is unset, so the
           chips read as checked even before the user has touched this filter. */}
      <div className={SECTION_CLASSES}>
        <fieldset>
          <legend className={`mb-3 ${SECTION_TITLE_CLASSES}`}>Listing Status</legend>
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTER_VALUES.map((status) => {
              const active = (value.status ?? DEFAULT_STATUS_FILTER).includes(status);
              return (
                <button
                  key={status}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleStatus(status)}
                  className={chipClasses(active)}
                >
                  {STATUS_FILTER_LABELS[status]}
                </button>
              );
            })}
          </div>
        </fieldset>
      </div>

      {/* ── Price ────────────────────────────────────────────────────────
          Max-only (#243): people search for what they can afford at most, not a minimum. `minPrice`
          stays in the contract for existing links, but this control never sets it.

          Label-left/control-right, matching Bedrooms and Bathrooms below (#256) — the row's own
          "Price" label replaces the section-title styling #254 gave it, so no separate legend. */}
      <div className={SECTION_CLASSES}>
        <div className="flex flex-wrap items-center justify-between gap-y-2">
          {rowLabel('Price', { htmlFor: 'filter-max-price', title: true })}
          <div className="flex items-center gap-1">
            {stepperButton({
              label: '–',
              accessibleName: 'Decrease maximum price',
              disabled: false,
              onClick: () => stepMaxPrice(-MAX_PRICE_STEP),
            })}
            <input
              id="filter-max-price"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              aria-invalid={maxPriceError}
              aria-describedby={maxPriceError ? 'filter-max-price-error' : undefined}
              placeholder="No max"
              value={maxPriceText}
              onChange={(event) => handleMaxPriceChange(event.target.value)}
              onBlur={commitMaxPrice}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                commitMaxPrice();
                event.currentTarget.blur();
              }}
              className={`${FIELD_CLASSES} ${
                maxPriceError
                  ? 'border-brand-700 text-brand-700 focus:ring-brand/20'
                  : 'border-surface-border focus:border-brand focus:ring-brand/20'
              }`}
            />
            {stepperButton({
              label: '+',
              accessibleName: 'Increase maximum price',
              disabled: false,
              onClick: () => stepMaxPrice(MAX_PRICE_STEP),
            })}
          </div>
        </div>
        {maxPriceError && (
          <p id="filter-max-price-error" className="mt-2 text-right text-xs text-brand-700">
            Enter a whole number, like 450000.
          </p>
        )}
      </div>

      {/* ── Beds / Baths / Square Feet — the dwelling group the interlock governs ── */}
      <div className={SECTION_CLASSES}>
        <fieldset>
          <legend className={`mb-3 ${SECTION_TITLE_CLASSES}`}>Size</legend>
          {parcelOnly && (
            <p id={PARCEL_HINT_ID} className="mb-3 text-xs text-ink-muted">
              {PARCEL_INTERLOCK_HINT}
            </p>
          )}
          <div className="flex flex-col gap-3">
            {stepper('beds', 'Bedrooms', parcelOnly)}
            {stepper('baths', 'Bathrooms', parcelOnly)}
            <div className="flex flex-wrap items-center justify-between gap-y-2">
              {rowLabel('Square Feet', { htmlFor: 'filter-sqft', disabled: parcelOnly })}
              <input
                id="filter-sqft"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                placeholder={parcelOnly ? 'Not applicable to land' : 'No min'}
                disabled={parcelOnly}
                aria-describedby={parcelHintId}
                className={`${FIELD_CLASSES} border-surface-border focus:border-brand focus:ring-brand/20 disabled:cursor-not-allowed disabled:bg-surface-alt disabled:text-ink-subtle`}
                value={parcelOnly ? '' : (value.minSqft ?? '')}
                onChange={(event) => set({ minSqft: wholeNumberOrUndefined(event.target.value) })}
              />
            </div>
          </div>
        </fieldset>
      </div>

      {/* ── Showing-only toggles ─────────────────────────────────────────
          `openHouse` and `newConstruction` are the only two booleans with a predicate of their own.
          `waterfront` and `petFriendly` are not here because server-side they *are* the amenities
          of the same name (see `parseFiltersFromSearchParams`), so they appear once, as chips. */}
      <div className={SECTION_CLASSES}>
        <fieldset>
          <legend className={`mb-3 ${SECTION_TITLE_CLASSES}`}>Show Only</legend>
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
                className={chipClasses(!!value[key])}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      {/* ── Amenities — the contract's closed 15-value set ───────────── */}
      <div className={SECTION_CLASSES}>
        <fieldset>
          <legend className={`mb-3 ${SECTION_TITLE_CLASSES}`}>Amenities</legend>
          <div className="flex flex-wrap gap-2">
            {AMENITIES.map((amenity) => {
              const active = value.amenities?.includes(amenity) ?? false;
              return (
                <button
                  key={amenity}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleAmenity(amenity)}
                  className={chipClasses(active)}
                >
                  {amenity}
                </button>
              );
            })}
          </div>
        </fieldset>
      </div>
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
      className={`group inline-flex h-11 w-11 shrink-0 select-none items-center justify-center rounded-full ${FOCUS_RING_CLASSES} ${
        disabled ? 'cursor-default' : 'cursor-pointer'
      }`}
    >
      {/* A 36px circle inside the 44px tap area. */}
      <span
        aria-hidden="true"
        className={`inline-flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${
          disabled
            ? 'border-surface-border text-ink-subtle/60'
            : 'border-surface-border-strong text-ink group-hover:border-brand group-hover:text-brand-700'
        }`}
      >
        {label === '+' ? <Plus className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
      </span>
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
