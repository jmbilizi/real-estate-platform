import { BRAND } from '@/lib/brand';

export default function BusinessPage() {
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
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21"
            />
          </svg>
        </span>
        <h1 className="font-display text-3xl font-extrabold sm:text-4xl">Business Directory</h1>
      </div>

      <p className="mt-4 text-lg leading-relaxed text-ink-muted">
        Find and connect with the trusted businesses and professionals behind every step of your
        real estate journey — from the agent who finds your home to the contractor who makes it
        yours.
      </p>

      <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-amber-50 px-4 py-1.5 text-sm font-medium text-amber-700 ring-1 ring-amber-200">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Coming soon — directory launching with first businesses
      </div>

      {/* How the directory works */}
      <div className="mt-12 rounded-2xl border border-surface-border bg-white p-6 shadow-card">
        <h2 className="font-display text-xl font-bold">One directory. Every real estate pro.</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          {BRAND.siteName} Business connects buyers, sellers, and homeowners with vetted
          professionals across every category — all in one place, with transparent profiles,
          reviews, and direct contact.
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {HOW_IT_WORKS.map((item) => (
            <div key={item.title} className="flex flex-col gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand/10 text-brand">
                {item.icon}
              </span>
              <h3 className="text-sm font-semibold">{item.title}</h3>
              <p className="text-xs leading-relaxed text-ink-muted">{item.description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Business categories */}
      <h2 className="mt-12 font-display text-2xl font-bold">Browse by category</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {BUSINESS_CATEGORIES.map((cat) => (
          <div
            key={cat.title}
            className="flex items-center gap-4 rounded-2xl border border-surface-border bg-white px-5 py-4 shadow-card opacity-70"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
              {cat.icon}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{cat.title}</p>
              <p className="truncate text-xs text-ink-muted">{cat.subtitle}</p>
            </div>
            <svg
              className="ml-auto h-4 w-4 shrink-0 text-ink-muted/40"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </div>
        ))}
      </div>

      {/* CTA: list your business */}
      <div className="mt-14 rounded-2xl border border-surface-border bg-surface-alt px-6 py-8 text-center">
        <h2 className="font-display text-xl font-bold">Own a real estate business?</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          Create a free business profile on {BRAND.siteName} and get discovered by buyers, sellers,
          and homeowners in your area. Agents, agencies, inspectors, movers, and contractors are all
          welcome.
        </p>
        <button
          disabled
          className="mt-5 rounded-full bg-brand px-6 py-2.5 text-sm font-semibold text-white opacity-50 cursor-not-allowed"
        >
          Create a business profile — coming soon
        </button>
      </div>
    </div>
  );
}

const HOW_IT_WORKS = [
  {
    title: 'Discover',
    description:
      'Search by category, location, and specialty to find the right professional for your needs.',
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
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>
    ),
  },
  {
    title: 'Compare',
    description:
      'Read verified reviews, check credentials, and compare profiles side by side before reaching out.',
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
          d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"
        />
      </svg>
    ),
  },
  {
    title: 'Connect',
    description:
      'Message directly, request a quote, or book a consultation — all without leaving ' +
      BRAND.siteName +
      '.',
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
          d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
        />
      </svg>
    ),
  },
];

const BUSINESS_CATEGORIES = [
  {
    title: 'Buyer & Seller Agents',
    subtitle: 'Licensed real estate agents and brokers',
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
    title: 'Real Estate Agencies',
    subtitle: 'Brokerages and property management firms',
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
          d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21"
        />
      </svg>
    ),
  },
  {
    title: 'Home Inspectors',
    subtitle: 'General and specialty inspection services',
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
    title: 'Mortgage & Lending',
    subtitle: 'Lenders, brokers, and financial advisors',
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
          d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
  },
  {
    title: 'Movers & Logistics',
    subtitle: 'Local, long-distance, and specialty movers',
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
          d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12"
        />
      </svg>
    ),
  },
  {
    title: 'Contractors & Renovations',
    subtitle: 'General contractors, trades, and designers',
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
          d="M21.75 6.75a4.5 4.5 0 01-4.884 4.484c-1.076-.091-2.264.071-2.95.904l-7.152 8.684a2.548 2.548 0 11-3.586-3.585l8.684-7.152c.833-.686.995-1.874.904-2.95a4.5 4.5 0 016.336-4.486l-3.276 3.276a3.004 3.004 0 002.25 2.25l3.276-3.276c.256.565.398 1.192.398 1.852z"
        />
      </svg>
    ),
  },
];
