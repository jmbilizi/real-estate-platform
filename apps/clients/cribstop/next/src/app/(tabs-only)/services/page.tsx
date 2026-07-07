import { BRAND } from '@/lib/brand';

export default function ServicesPage() {
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
              d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z"
            />
          </svg>
        </span>
        <h1 className="font-display text-3xl font-extrabold sm:text-4xl">
          {BRAND.siteName} Services
        </h1>
      </div>

      <p className="mt-4 text-lg leading-relaxed text-ink-muted">
        Your home journey doesn&apos;t end at the closing table. {BRAND.siteName} Services connects
        you with trusted professionals for every step — from your first showing to your last
        renovation.
      </p>

      <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-amber-50 px-4 py-1.5 text-sm font-medium text-amber-700 ring-1 ring-amber-200">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Coming soon — we&apos;re building something great
      </div>

      {/* Service categories */}
      <div className="mt-12 grid gap-6 sm:grid-cols-2">
        {SERVICE_CATEGORIES.map((cat) => (
          <div
            key={cat.title}
            className="rounded-2xl border border-surface-border bg-white p-6 shadow-card opacity-80"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand/10 text-brand">
                {cat.icon}
              </span>
              <h2 className="font-display text-lg font-bold">{cat.title}</h2>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-ink-muted">{cat.description}</p>
            <ul className="mt-3 space-y-1">
              {cat.examples.map((ex) => (
                <li key={ex} className="flex items-center gap-2 text-sm text-ink-muted">
                  <span className="h-1 w-1 rounded-full bg-brand/40" />
                  {ex}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-14 rounded-2xl border border-surface-border bg-surface-alt px-6 py-8 text-center">
        <h2 className="font-display text-xl font-bold">Are you a service provider?</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          Join our network of trusted professionals. Whether you&apos;re a licensed agent, a home
          inspector, or a moving company, {BRAND.siteName} Services will connect you directly with
          buyers, sellers, and homeowners in your market.
        </p>
        <button
          disabled
          className="mt-5 rounded-full bg-brand px-6 py-2.5 text-sm font-semibold text-white opacity-50 cursor-not-allowed"
        >
          Register your business — coming soon
        </button>
      </div>
    </div>
  );
}

const SERVICE_CATEGORIES = [
  {
    title: 'Buyer Agents',
    description:
      'Work with experienced buyer agents who know your market, negotiate on your behalf, and guide you from search to closing.',
    examples: [
      'Local market experts',
      'First-time buyer specialists',
      'Investment property advisors',
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
    title: 'Seller Agents',
    description:
      'List your home with confidence. Connect with listing agents who price accurately, market broadly, and close faster.',
    examples: [
      'Comparative market analysis',
      'Professional photography',
      'MLS & portal syndication',
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
    title: 'Home Inspectors',
    description:
      'Get a thorough inspection before you buy or sell. Our certified inspectors surface issues early so there are no surprises at closing.',
    examples: ['General home inspection', 'Radon & mold testing', 'Sewer scope & pool inspection'],
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
    title: 'Movers & Logistics',
    description:
      'Moving is stressful. ' +
      BRAND.siteName +
      ' Services will connect you with vetted movers, storage facilities, and logistics partners — locally and long-distance.',
    examples: ['Local moves', 'Long-distance relocation', 'Packing & unpacking services'],
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
    description:
      'From a fresh coat of paint to a full kitchen remodel, find pre-vetted contractors who deliver quality work on time and on budget.',
    examples: ['Kitchen & bath remodels', 'Roofing & HVAC', 'Landscaping & curb appeal'],
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
  {
    title: 'Mortgage & Finance',
    description:
      'Get pre-approved fast. ' +
      BRAND.siteName +
      ' will connect you with lenders, mortgage brokers, and financial advisors who specialize in real estate.',
    examples: ['Pre-approval in minutes', 'Rate comparison', 'First-time buyer programs'],
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
];
