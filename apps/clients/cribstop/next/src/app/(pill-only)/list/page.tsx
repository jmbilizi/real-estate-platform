import { BRAND } from '@/lib/brand';
import ListWaitlist from './ListWaitlist';

// Plain statements only. No listing tools exist yet, so the copy promises none. It says nothing
// about photo upload, lead capture or independent listing. The licensed brokerage is named.
const WHO_CAN_REGISTER = [
  { title: 'Agents', body: 'Register your interest if you plan to list homes.' },
  { title: 'Homeowners', body: 'Register your interest if you plan to sell or rent out a home.' },
  { title: 'Property managers', body: 'Register your interest if you manage homes for rent.' },
];

export default function ListPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand/10 text-brand">
          <svg
            className="h-6 w-6"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </span>
        <h1 className="font-display text-3xl font-extrabold sm:text-4xl">List a Property</h1>
      </div>

      <p className="mt-4 text-lg leading-relaxed text-ink-muted">
        Listing tools are not open yet. Tell us you want to list a home, and we will email you when
        they open.
      </p>

      <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-amber-50 px-4 py-1.5 text-sm font-medium text-amber-700 ring-1 ring-amber-200">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Coming soon
      </div>

      <section aria-labelledby="list-who-heading" className="mt-12">
        <h2 id="list-who-heading" className="font-display text-2xl font-bold">
          Who can register interest
        </h2>
        <ul className="mt-6 grid gap-4 sm:grid-cols-3">
          {WHO_CAN_REGISTER.map(({ title, body }) => (
            <li key={title} className="rounded-2xl border border-surface-border bg-white p-5">
              <h3 className="font-display text-base font-bold">{title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-ink-muted">{body}</p>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-sm leading-relaxed text-ink-muted">
          {BRAND.brokerage} is the licensed brokerage for listings on {BRAND.siteName}. Registering
          interest does not list a property.
        </p>
      </section>

      <ListWaitlist />
    </div>
  );
}
