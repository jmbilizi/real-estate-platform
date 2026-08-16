import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { isParcelOnlySelection, PARCEL_INTERLOCK_HINT } from '@/lib/store/types';

/** Ties the disabled dwelling steppers to their single visible explanation. */
const PARCEL_HINT_ID = 'filter-modal-parcel-interlock-hint';

export interface FilterModalContentHandle {
  clear: () => void;
  submit: () => void;
}

const propertyTypes = [
  { label: 'House', icon: '🏠' },
  { label: 'Townhome', icon: '🏢' },
  { label: 'Condo', icon: '🏢' },
  { label: 'Co-op', icon: '🏢' },
  { label: 'Lot/Land', icon: '🌳' },
  { label: 'Mobile Homes', icon: '🏡' },
  { label: 'Multi-Family', icon: '🏡' },
  { label: 'Other', icon: '🏢' },
];
const features = [
  { label: 'Open House', icon: '🚪' },
  { label: 'Pet Friendly', icon: '🐾' },
  { label: 'Waterfront', icon: '🌊' },
  { label: 'Garage', icon: '🚗' },
  { label: 'Pool', icon: '🏊' },
  { label: 'Fireplace', icon: '🔥' },
  { label: 'Garden', icon: '🌳' },
];

const listingStatuses = ['Coming Soon', 'Active', 'Under Contract', 'Pending'];
const listingTypes = [
  'Resale',
  'New Construction',
  'Pre-Foreclosure',
  'Foreclosure',
  'Short Sale',
  'Auction',
];

const FilterModalContent = forwardRef<
  FilterModalContentHandle,
  {
    onClear: (values?: any) => void;
    onShow: (values: any) => void;
  }
>(function FilterModalContent(
  {
    onClear,
    onShow,
  }: {
    onClear: (values?: any) => void;
    onShow: (values: any) => void;
  },
  ref,
) {
  const [selectedPropertyTypes, setSelectedPropertyTypes] = useState<string[]>([]);
  const [excludeActiveAdult, setExcludeActiveAdult] = useState(false);
  const [selectedListingStatus, setSelectedListingStatus] = useState<string[]>([]);
  const [selectedListingTypes, setSelectedListingTypes] = useState<string[]>([]);
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [luxury, setLuxury] = useState(false);
  const [beds, setBeds] = useState('');
  const [baths, setBaths] = useState('');
  const [yearBuiltMin, setYearBuiltMin] = useState('');
  const [yearBuiltMax, setYearBuiltMax] = useState('');
  const [storiesMin, setStoriesMin] = useState('');
  const [storiesMax, setStoriesMax] = useState('');
  const [parking, setParking] = useState('Any');
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);

  const toggleArrayValue = (arr: string[], value: string) =>
    arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];

  // --- Lot/Land interlock (#24) --------------------------------------------
  //
  // A parcel has no beds or baths, so the API's dwelling predicates exclude every parcel: asking
  // for Lot/Land AND 2+ beds returns nothing, with no explanation on screen. Both controls are
  // cleared and disabled while land is the only home type selected. The interlock lives in the UI,
  // never in the request builder — the API is meant to receive exactly what the user asked for.
  const parcelOnly = isParcelOnlySelection(selectedPropertyTypes);
  const parcelHintId = parcelOnly ? PARCEL_HINT_ID : undefined;

  useEffect(() => {
    if (!parcelOnly) return;
    if (beds !== '') setBeds('');
    if (baths !== '') setBaths('');
  }, [parcelOnly, beds, baths]);

  const handleShow = () => {
    onShow({
      selectedPropertyTypes,
      excludeActiveAdult,
      selectedListingStatus,
      selectedListingTypes,
      minPrice: luxury ? '1000000' : minPrice,
      maxPrice,
      // Belt and braces: land-only can never carry a dwelling count out of here even if some
      // future entry path sets one without going through the interlock above.
      beds: parcelOnly ? '' : beds,
      baths: parcelOnly ? '' : baths,
      yearBuiltMin,
      yearBuiltMax,
      storiesMin,
      storiesMax,
      parking,
      selectedFeatures,
      luxury,
    });
  };

  const handleClear = () => {
    setSelectedPropertyTypes([]);
    setExcludeActiveAdult(false);
    setSelectedListingStatus([]);
    setSelectedListingTypes([]);
    setMinPrice('');
    setMaxPrice('');
    setBeds('');
    setBaths('');
    setYearBuiltMin('');
    setYearBuiltMax('');
    setStoriesMin('');
    setStoriesMax('');
    setParking('Any');
    setSelectedFeatures([]);
    setLuxury(false);
    onClear();
  };

  useImperativeHandle(ref, () => ({
    clear: handleClear,
    submit: handleShow,
  }));

  return (
    <div className="grid grid-cols-1 gap-y-5">
      {/* ── Col 1: Home Type ─────────────────────────────────────────── */}
      <div>
        <div className="mb-2 font-semibold uppercase text-xs tracking-wider text-ink">
          Home Type
        </div>
        <div className="grid grid-cols-4 gap-2 mb-3">
          {propertyTypes.map((cat) => {
            const active = selectedPropertyTypes.includes(cat.label);
            return (
              <button
                key={cat.label}
                type="button"
                className={`flex flex-col items-center rounded-xl border py-3 text-[11px] font-normal transition ${
                  active
                    ? 'bg-blue-900 text-white border-blue-900'
                    : 'bg-white text-ink border-surface-border hover:bg-surface-alt'
                }`}
                onClick={() =>
                  setSelectedPropertyTypes(toggleArrayValue(selectedPropertyTypes, cat.label))
                }
              >
                <span className="text-xl mb-0.5">{cat.icon}</span>
                {cat.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="exclude-active-adult"
            className="form-checkbox h-4 w-4 rounded border-gray-300"
            checked={excludeActiveAdult}
            onChange={() => setExcludeActiveAdult((v) => !v)}
          />
          <label
            htmlFor="exclude-active-adult"
            className="text-sm font-normal text-ink cursor-pointer select-none flex items-center gap-1"
          >
            Exclude active adult
            <span
              className="relative inline-flex flex-col items-center justify-center ml-1 group"
              tabIndex={0}
              role="img"
            >
              <span
                className="absolute bottom-full left-1/2 z-10 mb-2 w-60 -translate-x-1/2 rounded-lg bg-white border border-surface-border px-3 py-2 text-xs text-ink opacity-0 group-hover:opacity-100 group-focus:opacity-100 transition-opacity pointer-events-none shadow-md text-center"
                role="tooltip"
              >
                Excludes <b>55+</b> or <b>active adult</b> communities from results.
                <span className="absolute bottom-0 left-1/2 translate-x-[-50%] translate-y-1/2 w-2 h-2 bg-white border-l border-b border-surface-border rotate-45"></span>
              </span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4 text-gray-400 cursor-pointer"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="white" />
                <text
                  x="12"
                  y="16"
                  textAnchor="middle"
                  fontSize="12"
                  fill="currentColor"
                  fontFamily="Arial"
                  dy="-2"
                >
                  i
                </text>
              </svg>
            </span>
          </label>
        </div>
      </div>

      {/* ── Col 2: Listing Status + Listing Type ─────────────────────── */}
      <div className="flex flex-col gap-4">
        <div>
          <div className="mb-2 font-semibold uppercase text-xs tracking-wider text-ink">
            Listing Status
          </div>
          <div className="grid grid-cols-2 gap-2">
            {listingStatuses.map((status) => {
              const active = selectedListingStatus.includes(status);
              return (
                <button
                  key={status}
                  type="button"
                  className={`rounded-xl border px-3 py-2 text-sm font-normal transition focus:outline-none ${
                    active
                      ? 'bg-blue-900 text-white border-blue-900'
                      : 'bg-white text-ink border-surface-border hover:bg-surface-alt'
                  }`}
                  onClick={() =>
                    setSelectedListingStatus(toggleArrayValue(selectedListingStatus, status))
                  }
                >
                  {status}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <div className="mb-2 font-semibold uppercase text-xs tracking-wider text-ink">
            Listing Type
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {listingTypes.map((type) => (
              <label
                key={type}
                className="flex items-center gap-2 text-sm font-normal text-ink cursor-pointer select-none"
              >
                <input
                  type="checkbox"
                  className="form-checkbox h-4 w-4 rounded border-gray-300"
                  checked={selectedListingTypes.includes(type)}
                  onChange={() =>
                    setSelectedListingTypes(toggleArrayValue(selectedListingTypes, type))
                  }
                />
                {type}
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* ── Col 3: Price + Beds + Baths ──────────────────────────────── */}
      <div className="flex flex-col gap-4">
        <div>
          <div className="mb-2 font-semibold uppercase text-xs tracking-wider text-ink">
            Price Range
          </div>
          <div className="flex gap-2 mb-2">
            <input
              type="number"
              placeholder="Min"
              className="w-1/2 rounded-xl border border-surface-border px-3 py-2 text-sm font-normal"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
            />
            <input
              type="number"
              placeholder="Max"
              className="w-1/2 rounded-xl border border-surface-border px-3 py-2 text-sm font-normal"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="luxury-toggle"
              className="form-checkbox h-4 w-4 rounded border-gray-300"
              checked={luxury}
              onChange={() => setLuxury((v) => !v)}
            />
            <label
              htmlFor="luxury-toggle"
              className="text-sm font-normal text-ink cursor-pointer select-none flex items-center gap-1"
            >
              Luxury (min $1M) <span title="Show only luxury homes (min $1M)">💎</span>
            </label>
          </div>
        </div>
        {(() => {
          const bedsOpts = ['Any', '1+', '2+', '3+', '4+', '5+', '6+', '7+', '8+'];
          const bathsOpts = ['Any', '1+', '2+', '3+', '4+', '5+', '6+', '7+', '8+'];
          const bedIdx = beds === '' ? 0 : bedsOpts.indexOf(beds);
          const bathIdx = baths === '' ? 0 : bathsOpts.indexOf(baths);
          const stepperBtn = (disabled: boolean, onClick: () => void, label: string) => (
            <button
              type="button"
              disabled={disabled}
              aria-disabled={disabled}
              aria-describedby={parcelHintId}
              onClick={onClick}
              className={`h-8 w-8 rounded-full border inline-flex items-center justify-center leading-none select-none transition-colors ${
                disabled
                  ? 'border-[rgba(0,0,0,0.12)] text-[rgba(0,0,0,0.2)] cursor-default'
                  : 'border-[rgba(0,0,0,0.4)] text-ink hover:border-ink cursor-pointer'
              }`}
              style={{ fontSize: '18px', paddingBottom: label === '–' ? '1px' : '0' }}
            >
              {label}
            </button>
          );
          const labelTone = parcelOnly ? 'text-ink-subtle' : 'text-ink';
          return (
            <div className="flex flex-col gap-3">
              {parcelOnly && (
                <p id={PARCEL_HINT_ID} className="text-xs text-ink-muted">
                  {PARCEL_INTERLOCK_HINT}
                </p>
              )}
              <div className="flex items-center justify-between py-1">
                <span className={`text-sm font-medium ${labelTone}`}>Bedrooms</span>
                <div className="flex items-center gap-5">
                  {stepperBtn(
                    parcelOnly || bedIdx === 0,
                    () => setBeds(bedIdx === 1 ? '' : bedsOpts[bedIdx - 1]),
                    '–',
                  )}
                  <span className={`w-8 text-center text-[15px] font-normal ${labelTone}`}>
                    {parcelOnly || bedIdx === 0 ? 'Any' : bedsOpts[bedIdx]}
                  </span>
                  {stepperBtn(
                    parcelOnly || bedIdx === bedsOpts.length - 1,
                    () => setBeds(bedsOpts[bedIdx + 1]),
                    '+',
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className={`text-sm font-medium ${labelTone}`}>Bathrooms</span>
                <div className="flex items-center gap-5">
                  {stepperBtn(
                    parcelOnly || bathIdx === 0,
                    () => setBaths(bathIdx === 1 ? '' : bathsOpts[bathIdx - 1]),
                    '–',
                  )}
                  <span className={`w-8 text-center text-[15px] font-normal ${labelTone}`}>
                    {parcelOnly || bathIdx === 0 ? 'Any' : bathsOpts[bathIdx]}
                  </span>
                  {stepperBtn(
                    parcelOnly || bathIdx === bathsOpts.length - 1,
                    () => setBaths(bathsOpts[bathIdx + 1]),
                    '+',
                  )}
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* ── Row 2 Col 1: Year Built + Stories ────────────────────────── */}
      <div className="flex flex-col gap-4">
        <div>
          <div className="mb-2 font-semibold uppercase text-xs tracking-wider text-ink">
            Year Built
          </div>
          <div className="flex gap-2">
            <select
              className="w-1/2 rounded-xl border border-surface-border px-3 py-2 text-sm font-normal"
              value={yearBuiltMin}
              onChange={(e) => setYearBuiltMin(e.target.value)}
            >
              <option value="">Any</option>
              {Array.from({ length: 55 }, (_, i) => new Date().getFullYear() - i).map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
            <span className="self-center text-ink-muted">–</span>
            <select
              className="w-1/2 rounded-xl border border-surface-border px-3 py-2 text-sm font-normal"
              value={yearBuiltMax}
              onChange={(e) => setYearBuiltMax(e.target.value)}
            >
              <option value="">Any</option>
              {Array.from({ length: 55 }, (_, i) => new Date().getFullYear() - i).map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <div className="mb-2 font-semibold uppercase text-xs tracking-wider text-ink">
            Stories
          </div>
          <div className="flex gap-2">
            <select
              className="w-1/2 rounded-xl border border-surface-border px-3 py-2 text-sm font-normal"
              value={storiesMin}
              onChange={(e) => setStoriesMin(e.target.value)}
            >
              <option value="">Any</option>
              {['1', '2', '3', '4', '5+'].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <span className="self-center text-ink-muted">–</span>
            <select
              className="w-1/2 rounded-xl border border-surface-border px-3 py-2 text-sm font-normal"
              value={storiesMax}
              onChange={(e) => setStoriesMax(e.target.value)}
            >
              <option value="">Any</option>
              {['1', '2', '3', '4', '5+'].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ── Row 2 Col 2: Parking ─────────────────────────────────────── */}
      <div>
        {(() => {
          const parkingOpts = ['Any', '1+', '2+', '3+', '4+', '5+', '6+', '7+', '8+'];
          const parkingIdx = parkingOpts.indexOf(parking);
          const stepperBtn = (disabled: boolean, onClick: () => void, label: string) => (
            <button
              type="button"
              disabled={disabled}
              onClick={onClick}
              className={`h-8 w-8 rounded-full border inline-flex items-center justify-center leading-none select-none transition-colors ${
                disabled
                  ? 'border-[rgba(0,0,0,0.12)] text-[rgba(0,0,0,0.2)] cursor-default'
                  : 'border-[rgba(0,0,0,0.4)] text-ink hover:border-ink cursor-pointer'
              }`}
              style={{ fontSize: '18px', paddingBottom: label === '–' ? '1px' : '0' }}
            >
              {label}
            </button>
          );
          return (
            <div className="flex items-center justify-between py-1">
              <span className="text-sm font-medium text-ink">Parking</span>
              <div className="flex items-center gap-5">
                {stepperBtn(parkingIdx === 0, () => setParking(parkingOpts[parkingIdx - 1]), '–')}
                <span className="w-8 text-center text-[15px] font-normal text-ink">
                  {parkingOpts[parkingIdx]}
                </span>
                {stepperBtn(
                  parkingIdx === parkingOpts.length - 1,
                  () => setParking(parkingOpts[parkingIdx + 1]),
                  '+',
                )}
              </div>
            </div>
          );
        })()}
      </div>

      {/* ── Row 2 Col 3: Features ─────────────────────────────────────── */}
      <div>
        <div className="mb-2 font-semibold uppercase text-xs tracking-wider text-ink">Features</div>
        <div className="grid grid-cols-4 gap-2">
          {features.map((feat) => {
            const active = selectedFeatures.includes(feat.label);
            return (
              <button
                key={feat.label}
                type="button"
                className={`flex flex-col items-center rounded-xl border py-3 text-[11px] font-normal transition ${
                  active
                    ? 'bg-blue-900 text-white border-blue-900'
                    : 'bg-white text-ink border-surface-border hover:bg-surface-alt'
                }`}
                onClick={() => setSelectedFeatures(toggleArrayValue(selectedFeatures, feat.label))}
              >
                <span className="text-xl mb-0.5">{feat.icon}</span>
                {feat.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
});

export default FilterModalContent;
