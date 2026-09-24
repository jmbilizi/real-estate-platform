import React, { useEffect, useState } from 'react';
import { AMENITIES, PROPERTY_TYPES } from '@cribstop/property-contracts';
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
  'Manufactured/Mobile': '🏚️',
};

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
function rowLabel(text: string, { htmlFor, disabled }: { htmlFor?: string; disabled?: boolean }) {
  const className = `text-sm font-medium ${disabled ? 'text-ink-subtle' : 'text-ink'}`;
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
      <div className="flex flex-wrap items-center justify-between gap-y-2 py-1">
        {rowLabel(label, { disabled })}
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
      {/* ── Home type ── Multi-select. A listing matches any selected type. */}
      <fieldset>
        <legend className="mb-2 font-semibold uppercase text-xs tracking-wider text-ink">
          Home Type
        </legend>
        <div className="grid grid-cols-4 gap-2">
          {PROPERTY_TYPES.map((type) => {
            const selected = value.propertyType ?? [];
            const active = selected.includes(type);
            const next = active ? selected.filter((t) => t !== type) : [...selected, type];
            return (
              <button
                key={type}
                type="button"
                aria-pressed={active}
                onClick={() => set({ propertyType: next.length > 0 ? next : undefined })}
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

      {/* ── Price ────────────────────────────────────────────────────────
          Max-only (#243): people search for what they can afford at most, not a minimum. `minPrice`
          stays in the contract for existing links, but this control never sets it.

          Label-left/control-right, matching Bedrooms and Bathrooms below (#256) — the row's own
          "Price" label replaces the section-title styling #254 gave it, so no separate legend. */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-y-2 py-1">
          {rowLabel('Price', { htmlFor: 'filter-max-price' })}
          <div className="flex items-center gap-5">
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
              className={`w-28 rounded-full border px-3 py-1.5 text-center text-[15px] font-normal focus:outline-none focus:ring-1 ${
                maxPriceError
                  ? 'border-red-400 text-red-600 focus:ring-red-400'
                  : 'border-surface-border text-ink focus:ring-surface-border-strong'
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
          <p id="filter-max-price-error" className="text-xs text-red-600">
            Enter a whole number, like 450000.
          </p>
        )}
      </div>

      {/* ── Beds / Baths / Square Feet — the dwelling group the interlock governs ── */}
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
          <div className="flex flex-wrap items-center justify-between gap-y-2 py-1">
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
              className="w-28 rounded-full border border-surface-border px-3 py-1.5 text-center text-[15px] font-normal focus:outline-none focus:ring-1 focus:ring-surface-border-strong disabled:bg-surface-alt disabled:text-ink-subtle disabled:cursor-not-allowed"
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
