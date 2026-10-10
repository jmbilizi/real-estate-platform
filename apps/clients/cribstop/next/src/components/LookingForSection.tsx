'use client';

import { useCallback, useEffect, useState } from 'react';
import { PROPERTY_TYPES } from '@cribstop/property-contracts';
import {
  deleteLookingFor,
  getLookingFor,
  type LookingFor,
  LookingForError,
  type LookingForInput,
  type LookingForPlace,
  saveLookingFor,
} from '@/lib/api/looking-for';
import { type DateRange, DateRangePanel } from '@/components/DateRangePanel';
import { formatPrice } from '@/lib/format';

const MAX_PLACES = 5;
const ROOM_CHOICES = ['1', '2', '3', '4', '5'];

/** `raw` holds a place kind this form cannot edit. It goes back to the API unchanged. */
type PlaceDraft = { city: string; state: string; zip: string; raw?: LookingForPlace };

const EDITABLE_KINDS = ['city', 'zip'];

function localToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const FIELD_MESSAGES: Record<string, string> = {
  intent: 'Choose buy or rent.',
  places: 'Give 1 to 5 places, each with a city and a two-letter state.',
  priceMin: 'Enter a price from 0 to 100,000,000.',
  priceMax: 'Enter a price from 0 to 100,000,000, not below the minimum.',
  bedsMin: 'Choose a bedroom count.',
  bathsMin: 'Choose a bathroom count.',
  homeTypes: 'Choose home types from the list.',
  whenStart: 'The date must not be in the past.',
  whenEnd: 'The end date must not be before the start date.',
};

/** property-service names a bad place as `places`. The form shows it under the places group. */
function messageFor(field: string): string | undefined {
  return FIELD_MESSAGES[field.startsWith('places[') ? 'places' : field];
}
type Draft = {
  id: string;
  intent: 'buy' | 'rent';
  places: PlaceDraft[];
  priceMin: string;
  priceMax: string;
  bedsMin: string;
  bathsMin: string;
  homeTypes: string[];
  dateRange: DateRange;
};

const emptyRange = (): DateRange => ({ start: '', end: '', flexibility: 'exact' });

function newDraft(): Draft {
  return {
    id: crypto.randomUUID(),
    intent: 'buy',
    places: [{ city: '', state: '', zip: '' }],
    priceMin: '',
    priceMax: '',
    bedsMin: '',
    bathsMin: '',
    homeTypes: [],
    dateRange: emptyRange(),
  };
}

function draftFrom(item: LookingFor): Draft {
  return {
    id: item.id,
    intent: item.intent,
    places: item.places.map((p) =>
      EDITABLE_KINDS.includes(p.kind)
        ? { city: p.city ?? '', state: p.state, zip: p.zip ?? '' }
        : { city: '', state: '', zip: '', raw: p },
    ),
    priceMin: item.priceMin == null ? '' : String(item.priceMin),
    priceMax: item.priceMax == null ? '' : String(item.priceMax),
    bedsMin: item.bedsMin == null ? '' : String(item.bedsMin),
    bathsMin: item.bathsMin == null ? '' : String(item.bathsMin),
    homeTypes: item.homeTypes,
    dateRange: {
      start: item.whenStart ?? '',
      end: item.whenEnd ?? (item.whenStart ? item.whenStart : ''),
      flexibility: 'exact',
    },
  };
}

function toInput(draft: Draft): LookingForInput {
  const places: LookingForPlace[] = draft.places
    .filter((p) => p.raw || p.city.trim() || p.state.trim() || p.zip.trim())
    .map(
      (p): LookingForPlace =>
        p.raw ?? {
          kind: p.zip.trim() ? 'zip' : 'city',
          state: p.state.trim().toUpperCase(),
          city: p.city.trim(),
          ...(p.zip.trim() ? { zip: p.zip.trim() } : {}),
        },
    );
  const num = (v: string) => (v.trim() === '' ? null : Number(v));
  const { start, end } = draft.dateRange;
  return {
    intent: draft.intent,
    places,
    priceMin: num(draft.priceMin),
    priceMax: num(draft.priceMax),
    bedsMin: num(draft.bedsMin),
    bathsMin: num(draft.bathsMin),
    homeTypes: draft.homeTypes,
    whenStart: start || null,
    whenEnd: start && end && end !== start ? end : null,
  };
}

function placeLabel(p: LookingForPlace): string {
  if (p.kind === 'county') return `${p.county} County, ${p.state}`;
  if (p.kind === 'zip') return `${p.zip}, ${p.city}, ${p.state}`;
  if (p.kind === 'city') return `${p.city}, ${p.state}`;
  return `${p.name}, ${p.city}, ${p.state}`;
}

function whenLabel(item: LookingFor): string | null {
  if (!item.whenStart) return null;
  const label = item.intent === 'rent' ? 'Move-in date' : 'Buying window';
  const text = item.whenEnd
    ? `${label}: ${item.whenStart} to ${item.whenEnd}`
    : `${label}: ${item.whenStart}`;
  return item.whenStart < localToday() ? `${text} (expired, edit to update or clear it)` : text;
}

function summary(item: LookingFor): string[] {
  const parts: string[] = [];
  const side = item.intent === 'rent' ? 'rent' : 'sale';
  if (item.priceMin != null || item.priceMax != null) {
    const lo = item.priceMin != null ? formatPrice(item.priceMin, side) : 'Any';
    const hi = item.priceMax != null ? formatPrice(item.priceMax, side) : 'Any';
    parts.push(`Price: ${lo} to ${hi}`);
  }
  if (item.bedsMin != null) parts.push(`Bedrooms: ${item.bedsMin}+`);
  if (item.bathsMin != null) parts.push(`Bathrooms: ${item.bathsMin}+`);
  if (item.homeTypes.length > 0) parts.push(`Home type: ${item.homeTypes.join(', ')}`);
  const when = whenLabel(item);
  if (when) parts.push(when);
  return parts;
}

/** Same shape as the loaded section: a heading bar and two preference rows. */
export function LookingForSkeleton() {
  return (
    <div data-testid="looking-for-skeleton" aria-busy="true" aria-label="Loading preferences">
      <ul className="divide-y divide-surface-border">
        {[0, 1].map((i) => (
          <li key={i} className="px-5 py-4">
            <div className="h-4 w-2/5 animate-pulse rounded bg-surface-alt" />
            <div className="mt-2 h-3 w-4/5 animate-pulse rounded bg-surface-alt" />
            <div className="mt-2 h-3 w-3/5 animate-pulse rounded bg-surface-alt" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The "What I'm looking for" section of the account page (#768). It stores facts about the home
 * and an optional date. It sends no email (alerts need their own opt-in, #505 and #769).
 */
export default function LookingForSection() {
  const [items, setItems] = useState<LookingFor[] | null>(null);
  const [max, setMax] = useState(5);
  const [loadFailed, setLoadFailed] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoadFailed(false);
    getLookingFor()
      .then((list) => {
        setItems(list.items);
        setMax(list.max);
      })
      .catch(() => setLoadFailed(true));
  }, []);

  useEffect(load, [load]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setFieldErrors([]);
    try {
      const saved = await saveLookingFor(draft.id, toInput(draft));
      setItems((prev) => [saved, ...(prev ?? []).filter((i) => i.id !== saved.id)]);
      setDraft(null);
    } catch (err) {
      if (err instanceof LookingForError && err.code === 'limit_reached') {
        setError(`You can save up to ${max} preferences. Delete one to add another.`);
      } else if (err instanceof LookingForError && err.code === 'invalid') {
        setFieldErrors(err.fields);
        setError('Some values need a change. See the messages below each field.');
      } else {
        setError('Could not save. Try again.');
      }
    }
    setSaving(false);
  };

  const remove = async (id: string) => {
    setError(null);
    try {
      await deleteLookingFor(id);
      setItems((prev) => (prev ?? []).filter((i) => i.id !== id));
    } catch {
      setError('Could not delete. Try again.');
    }
  };

  return (
    <section
      aria-labelledby="looking-for-heading"
      className="mt-10 rounded-2xl border border-surface-border bg-white shadow-card"
    >
      <div className="flex items-center justify-between gap-3 border-b border-surface-border px-5 py-4">
        <h2
          id="looking-for-heading"
          className="text-sm font-semibold uppercase tracking-wide text-ink-muted"
        >
          What I&apos;m looking for
        </h2>
        {!draft && items && items.length < max && (
          <button
            type="button"
            onClick={() => setDraft(newDraft())}
            className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-brand hover:bg-brand/10"
          >
            Add
          </button>
        )}
      </div>

      <p className="px-5 pt-4 text-xs text-ink-muted">
        This sets no email yet. Email alerts need your separate opt-in when they launch.
      </p>

      {error && (
        <p role="alert" className="px-5 pt-3 text-sm text-red-600">
          {error}
        </p>
      )}

      {loadFailed && (
        <div className="px-5 py-4 text-sm">
          <p role="alert" className="text-red-600">
            Could not load your preferences.
          </p>
          <button type="button" onClick={load} className="mt-2 font-medium text-brand">
            Try again
          </button>
        </div>
      )}

      {!loadFailed && items === null && <LookingForSkeleton />}

      {items && !draft && items.length === 0 && (
        <p className="px-5 py-4 text-sm text-ink-muted">No preferences yet.</p>
      )}

      {items && !draft && items.length > 0 && (
        <ul className="divide-y divide-surface-border">
          {items.map((item) => (
            <li key={item.id} className="px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">
                    {item.intent === 'rent' ? 'Rent' : 'Buy'}:{' '}
                    {item.places.map(placeLabel).join('; ')}
                  </p>
                  {summary(item).map((line) => (
                    <p key={line} className="break-words text-xs text-ink-muted">
                      {line}
                    </p>
                  ))}
                </div>
                <div className="flex flex-shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => setDraft(draftFrom(item))}
                    aria-label={`Edit ${item.intent} preference`}
                    className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-brand hover:bg-brand/10"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(item.id)}
                    aria-label={`Delete ${item.intent} preference`}
                    className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-ink-muted hover:bg-surface-alt"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {draft && (
        <LookingForForm
          draft={draft}
          setDraft={setDraft}
          saving={saving}
          fieldErrors={fieldErrors}
          onSave={save}
          onCancel={() => {
            setDraft(null);
            setError(null);
            setFieldErrors([]);
          }}
        />
      )}
    </section>
  );
}

function LookingForForm({
  draft,
  setDraft,
  saving,
  fieldErrors,
  onSave,
  onCancel,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  saving: boolean;
  fieldErrors: string[];
  onSave: () => void;
  onCancel: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [rangePickStep, setRangePickStep] = useState<'start' | 'end'>('start');
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const [calendarBaseMonth, setCalendarBaseMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft({ ...draft, [key]: value });
  const setPlace = (index: number, patch: Partial<PlaceDraft>) =>
    set(
      'places',
      draft.places.map((p, i) => (i === index ? { ...p, ...patch } : p)),
    );

  const label = 'mb-1 block text-sm font-medium text-ink-muted';
  const whenText = draft.dateRange.start
    ? draft.dateRange.end && draft.dateRange.end !== draft.dateRange.start
      ? `${draft.dateRange.start} to ${draft.dateRange.end}`
      : draft.dateRange.start
    : 'No date';
  const hasPlace = draft.places.some((p) => p.raw || (p.city.trim() && p.state.trim()));
  const expired = !!draft.dateRange.start && draft.dateRange.start < localToday();
  const has = (key: string) =>
    fieldErrors.some((f) => (key === 'places' ? f.startsWith('places') : f === key));
  const aria = (key: string) =>
    has(key) ? { 'aria-invalid': true, 'aria-describedby': `lf-err-${key}` } : {};
  const msg = (key: string) =>
    has(key) ? (
      <p id={`lf-err-${key}`} className="mt-1 text-xs text-red-600">
        {messageFor(key)}
      </p>
    ) : null;
  const whenKey = has('whenStart') ? 'whenStart' : 'whenEnd';

  return (
    <form
      className="flex flex-col gap-4 px-5 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <div>
        <label htmlFor="lf-intent" className={label}>
          I want to
        </label>
        <select
          id="lf-intent"
          className="input-field min-h-11"
          value={draft.intent}
          onChange={(e) => set('intent', e.target.value as Draft['intent'])}
        >
          <option value="buy">Buy</option>
          <option value="rent">Rent</option>
        </select>
      </div>

      <fieldset className="flex flex-col gap-3" {...aria('places')}>
        <legend className={label}>Places (up to {MAX_PLACES})</legend>
        {msg('places')}
        {draft.places.map((place, i) =>
          place.raw ? (
            <div key={i} className="flex items-center justify-between gap-2 text-sm text-ink">
              <span className="min-w-0 break-words">{placeLabel(place.raw)}</span>
              <button
                type="button"
                aria-label={`Remove place ${i + 1}`}
                onClick={() =>
                  set(
                    'places',
                    draft.places.filter((_, j) => j !== i),
                  )
                }
                className="min-h-11 text-sm text-ink-muted hover:text-ink"
              >
                Remove
              </button>
            </div>
          ) : (
            <div key={i} className="grid grid-cols-6 gap-2">
              <input
                aria-label={`City ${i + 1}`}
                {...aria('places')}
                placeholder="City"
                className="input-field col-span-6 min-h-11 sm:col-span-3"
                value={place.city}
                onChange={(e) => setPlace(i, { city: e.target.value })}
              />
              <input
                aria-label={`State ${i + 1}`}
                placeholder="State"
                maxLength={2}
                className="input-field col-span-2 min-h-11 uppercase sm:col-span-1"
                value={place.state}
                onChange={(e) => setPlace(i, { state: e.target.value })}
              />
              <input
                aria-label={`ZIP code ${i + 1} (optional)`}
                placeholder="ZIP code"
                inputMode="numeric"
                maxLength={5}
                className="input-field col-span-3 min-h-11 sm:col-span-2"
                value={place.zip}
                onChange={(e) => setPlace(i, { zip: e.target.value.replace(/\D/g, '') })}
              />
              {draft.places.length > 1 && (
                <button
                  type="button"
                  aria-label={`Remove place ${i + 1}`}
                  onClick={() =>
                    set(
                      'places',
                      draft.places.filter((_, j) => j !== i),
                    )
                  }
                  className="col-span-1 min-h-11 text-sm text-ink-muted hover:text-ink"
                >
                  Remove
                </button>
              )}
            </div>
          ),
        )}
        {draft.places.length < MAX_PLACES && (
          <button
            type="button"
            onClick={() => set('places', [...draft.places, { city: '', state: '', zip: '' }])}
            className="min-h-11 self-start text-sm font-medium text-brand"
          >
            Add a place
          </button>
        )}
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="lf-price-min" className={label}>
            Minimum price
          </label>
          <input
            id="lf-price-min"
            {...aria('priceMin')}
            inputMode="numeric"
            className="input-field min-h-11"
            value={draft.priceMin}
            onChange={(e) => set('priceMin', e.target.value.replace(/\D/g, ''))}
          />
          {msg('priceMin')}
        </div>
        <div>
          <label htmlFor="lf-price-max" className={label}>
            Maximum price
          </label>
          <input
            id="lf-price-max"
            {...aria('priceMax')}
            inputMode="numeric"
            className="input-field min-h-11"
            value={draft.priceMax}
            onChange={(e) => set('priceMax', e.target.value.replace(/\D/g, ''))}
          />
          {msg('priceMax')}
        </div>
        <div>
          <label htmlFor="lf-beds" className={label}>
            Bedrooms
          </label>
          <select
            id="lf-beds"
            {...aria('bedsMin')}
            className="input-field min-h-11"
            value={draft.bedsMin}
            onChange={(e) => set('bedsMin', e.target.value)}
          >
            <option value="">Any</option>
            {ROOM_CHOICES.map((n) => (
              <option key={n} value={n}>
                {n}+
              </option>
            ))}
          </select>
          {msg('bedsMin')}
        </div>
        <div>
          <label htmlFor="lf-baths" className={label}>
            Bathrooms
          </label>
          <select
            id="lf-baths"
            {...aria('bathsMin')}
            className="input-field min-h-11"
            value={draft.bathsMin}
            onChange={(e) => set('bathsMin', e.target.value)}
          >
            <option value="">Any</option>
            {ROOM_CHOICES.slice(0, 4).map((n) => (
              <option key={n} value={n}>
                {n}+
              </option>
            ))}
          </select>
          {msg('bathsMin')}
        </div>
      </div>

      <fieldset {...aria('homeTypes')}>
        <legend className={label}>Home type</legend>
        {msg('homeTypes')}
        <div className="flex flex-wrap gap-2">
          {PROPERTY_TYPES.map((type) => {
            const on = draft.homeTypes.includes(type);
            return (
              <label
                key={type}
                className={`inline-flex min-h-11 cursor-pointer items-center rounded-full border px-3.5 text-sm ${
                  on ? 'border-ink bg-ink text-white' : 'border-surface-border text-ink'
                }`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={on}
                  onChange={() =>
                    set(
                      'homeTypes',
                      on ? draft.homeTypes.filter((t) => t !== type) : [...draft.homeTypes, type],
                    )
                  }
                />
                {type}
              </label>
            );
          })}
        </div>
      </fieldset>

      <div>
        <p className={label}>{draft.intent === 'rent' ? 'Move-in date' : 'Buying window'}</p>
        <div className="flex items-center gap-3">
          <span className="text-sm text-ink">{whenText}</span>
          <button
            type="button"
            onClick={() => setPickerOpen((open) => !open)}
            aria-expanded={pickerOpen}
            className="min-h-11 text-sm font-medium text-brand"
          >
            {pickerOpen ? 'Close calendar' : 'Choose date'}
          </button>
          {draft.dateRange.start && (
            <button
              type="button"
              onClick={() => {
                set('dateRange', emptyRange());
                setRangePickStep('start');
              }}
              className="min-h-11 text-sm font-medium text-ink-muted hover:text-ink"
            >
              Clear date
            </button>
          )}
        </div>
        {expired && (
          <p role="alert" className="text-xs text-red-600">
            This date has passed. Choose a new date or clear it before you save.
          </p>
        )}
        {!expired && has(whenKey) && (
          <p id={`lf-err-${whenKey}`} className="text-xs text-red-600">
            {messageFor(whenKey)}
          </p>
        )}
        {pickerOpen && (
          <DateRangePanel
            inline
            showFlexibility={false}
            dateRange={draft.dateRange}
            setDateRange={(dateRange) => set('dateRange', dateRange)}
            rangePickStep={rangePickStep}
            setRangePickStep={setRangePickStep}
            hoveredDate={hoveredDate}
            setHoveredDate={setHoveredDate}
            calendarBaseMonth={calendarBaseMonth}
            setCalendarBaseMonth={setCalendarBaseMonth}
            onClose={() => setPickerOpen(false)}
            listingType={draft.intent === 'rent' ? 'for-rent' : 'for-sale'}
          />
        )}
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          className="btn-primary min-h-11 flex-1"
          disabled={saving || !hasPlace || expired}
        >
          {saving ? 'Saving' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary min-h-11 flex-1">
          Cancel
        </button>
      </div>
    </form>
  );
}
