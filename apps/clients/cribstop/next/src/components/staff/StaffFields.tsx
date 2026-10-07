import { STAFF_NOTE_MAX_LENGTH } from '@cribstop/property-contracts';
import { NOTE_HINT } from '@/lib/staff-leads';

/** Shared form pieces of the staff area. Every control is at least 44px tall (`min-h-11`). */

export const FIELD =
  'w-full rounded-md border border-surface-border bg-white px-3 py-2.5 text-sm text-ink focus:border-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ink';
export const FIELD_TALL = `min-h-11 ${FIELD}`;
export const LINK =
  'inline-flex min-h-11 items-center font-semibold text-ink underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink';

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-surface-border bg-white p-4 sm:p-5">
      <h2 className="mb-3 text-base font-bold text-ink">{title}</h2>
      {children}
    </section>
  );
}

export function NoteField({
  id,
  value,
  onChange,
  required,
  label,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  label: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold text-ink">
        {label}
        {required && <span className="font-normal text-ink-muted"> (required)</span>}
      </label>
      <textarea
        id={id}
        rows={4}
        maxLength={STAFF_NOTE_MAX_LENGTH}
        className={FIELD}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={`${id}-hint`}
      />
      <p id={`${id}-hint`} className="mt-1 text-xs text-ink-muted">
        {NOTE_HINT}
      </p>
    </div>
  );
}

export function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md bg-brand-50 px-3 py-2 text-sm text-brand-900">
      {message}
    </p>
  );
}
