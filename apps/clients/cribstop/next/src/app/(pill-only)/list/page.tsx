export default function ListPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand/10 text-brand">
          <svg
            className="h-6 w-6"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </span>
        <h1 className="font-display text-3xl font-extrabold sm:text-4xl">List a Property</h1>
      </div>

      <p className="mt-4 text-lg leading-relaxed text-ink-muted">
        Whether you&apos;re an agent ready to post a new listing, a homeowner selling independently,
        or someone claiming an existing property — Cribstop makes it simple to get your home in
        front of the right buyers.
      </p>

      <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-amber-50 px-4 py-1.5 text-sm font-medium text-amber-700 ring-1 ring-amber-200">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Coming soon — listing tools are on their way
      </div>

      {/* Options */}
      <div className="mt-12 grid gap-6 sm:grid-cols-2">
        {LISTING_OPTIONS.map((opt) => (
          <div
            key={opt.title}
            className="rounded-2xl border border-surface-border bg-white p-6 shadow-card opacity-80"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand/10 text-brand">
                {opt.icon}
              </span>
              <h2 className="font-display text-lg font-bold">{opt.title}</h2>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-ink-muted">{opt.description}</p>
            <ul className="mt-3 space-y-1">
              {opt.features.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-ink-muted">
                  <span className="h-1 w-1 rounded-full bg-brand/40" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* How it works */}
      <div className="mt-14">
        <h2 className="font-display text-2xl font-bold">How it will work</h2>
        <ol className="mt-6 space-y-6">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">
                {i + 1}
              </span>
              <div>
                <h3 className="font-semibold">{step.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-ink-muted">{step.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-14 rounded-2xl border border-surface-border bg-surface-alt px-6 py-8 text-center">
        <h2 className="font-display text-xl font-bold">Ready to list when you are</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          Join the waitlist and be the first to access Cribstop&apos;s listing tools when they
          launch. Agents, homeowners, and property managers are all welcome.
        </p>
        <button
          disabled
          className="mt-5 rounded-full bg-brand px-6 py-2.5 text-sm font-semibold text-white opacity-50 cursor-not-allowed"
        >
          Join the waitlist — coming soon
        </button>
      </div>
    </div>
  );
}

const LISTING_OPTIONS = [
  {
    title: 'List as an Agent',
    description:
      'Licensed agents can create full MLS-grade listings with photos, open house schedules, buyer requirements, and direct lead capture.',
    features: [
      'Upload professional photos & virtual tours',
      'Set open house dates & private showings',
      'Receive and manage buyer leads directly',
      'Attribution on every listing page',
    ],
    icon: (
      <svg
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
        />
      </svg>
    ),
  },
  {
    title: 'List as an Owner',
    description:
      'Selling or renting without an agent? Post your property directly and control your listing, schedule, and communications.',
    features: [
      'For Sale By Owner (FSBO) listings',
      'For Rent By Owner (FRBO) listings',
      'Set your own price & terms',
      'Chat directly with interested buyers',
    ],
    icon: (
      <svg
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"
        />
      </svg>
    ),
  },
  {
    title: 'Claim a Listing',
    description:
      'Already have a property showing on Cribstop from an MLS feed? Claim ownership to add photos, respond to inquiries, and keep details up to date.',
    features: [
      'Verify ownership with a simple process',
      'Enhance your listing with extra details',
      'Respond to buyer questions directly',
      'Manage price changes & status updates',
    ],
    icon: (
      <svg
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
        />
      </svg>
    ),
  },
  {
    title: 'Rental Listings',
    description:
      'Property managers and landlords can post long-term rentals and short-term stays, set screening criteria, and manage applications in one place.',
    features: [
      'Long-term & short-term rentals',
      'Set tenant screening requirements',
      'Digital lease & application flow',
      'Rent payment tracking (coming later)',
    ],
    icon: (
      <svg
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
        />
      </svg>
    ),
  },
];

const STEPS = [
  {
    title: 'Create your account',
    description:
      'Sign up as an agent, owner, or property manager. Agents will go through a license verification step.',
  },
  {
    title: 'Add your property details',
    description:
      'Enter the address, property type, price, and key details. Upload photos, floor plans, and a virtual tour if available.',
  },
  {
    title: 'Publish and get discovered',
    description:
      'Your listing goes live on Cribstop and is indexed for search. Buyers find you through search, map, and saved alerts.',
  },
  {
    title: 'Manage leads and showings',
    description:
      'Receive inquiries directly in your dashboard, schedule showings, and communicate with buyers — all in one place.',
  },
];
