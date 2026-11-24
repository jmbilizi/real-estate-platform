'use client';

import type { LucideIcon } from 'lucide-react';
import {
  Calculator,
  Check,
  ClipboardCheck,
  Hammer,
  Home,
  Truck,
  UserRound,
  Wrench,
} from 'lucide-react';
import { BRAND } from '@/lib/brand';
import { useWaitlist } from '@/lib/useWaitlist';
import type { WaitlistInterest } from '@/lib/api/waitlist';

const PILLAR = BRAND.pillars.services;

// Plain descriptions of what the product will do. No counts, ratings, names, fees or referral
// terms: no provider network exists yet, and RESPA bars fee claims about settlement services.
const WILL_INCLUDE: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: UserRound,
    title: 'Agents',
    body: 'Find an agent for buying, selling or renting a home.',
  },
  {
    icon: ClipboardCheck,
    title: 'Home inspection',
    body: 'Find inspectors for the home you plan to buy or sell.',
  },
  {
    icon: Truck,
    title: 'Moving',
    body: 'Find movers and storage for a local or long-distance move.',
  },
  {
    icon: Hammer,
    title: 'Renovation',
    body: 'Find contractors for repairs, remodels and yard work.',
  },
  {
    icon: Wrench,
    title: 'Home maintenance',
    body: 'Find help for roofing, heating and cooling, plumbing and similar jobs.',
  },
  {
    icon: Calculator,
    title: 'Lending',
    body: 'Find lenders and mortgage brokers.',
  },
];

type Waitlist = ReturnType<typeof useWaitlist>;

function WaitlistButton({
  waitlist,
  kind,
  idleLabel,
  describedBy,
}: {
  waitlist: Waitlist;
  kind: WaitlistInterest;
  idleLabel: string;
  describedBy: string;
}) {
  const joined = waitlist.isJoined(kind);
  return (
    <>
      <button
        type="button"
        className={`${joined ? 'btn-secondary' : 'btn-primary'} min-h-11 w-full sm:w-auto`}
        disabled={!waitlist.ready || waitlist.isBusy(kind)}
        aria-pressed={joined}
        aria-describedby={describedBy}
        onClick={() => waitlist.toggle(kind)}
      >
        {joined ? (
          <>
            <Check className="mr-2 h-4 w-4" aria-hidden="true" />
            You&apos;re on the list
          </>
        ) : (
          idleLabel
        )}
      </button>
      {joined && (
        <p className="mt-3 text-sm text-ink-muted">Tap the button again to leave the list.</p>
      )}
    </>
  );
}

export default function ServicesPage() {
  // One hook instance: one session read and one list fetch for both buttons.
  const waitlist = useWaitlist();

  return (
    <div className="min-h-screen bg-white">
      <section className="bg-gradient-to-b from-surface-soft to-white">
        <div className="page-gutter mx-auto max-w-6xl pb-2 pt-12 text-center sm:pt-16">
          <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-brand/20 bg-brand-50 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-700">
            <Home className="h-3.5 w-3.5" aria-hidden="true" />
            Coming Soon
          </span>
          <h1 className="font-display text-3xl font-bold tracking-tight text-ink">
            {BRAND.siteName} {PILLAR} is coming.
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-lg text-ink-muted">
            Soon you can find the professionals who help with a home, from the first showing to the
            last repair. {PILLAR} is not open yet.
          </p>
        </div>
      </section>

      <section className="page-gutter mx-auto max-w-6xl py-10 sm:py-14">
        <h2 className="sr-only">What {PILLAR} will include</h2>
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {WILL_INCLUDE.map(({ icon: Icon, title, body }) => (
            <li key={title} className="rounded-lg border border-surface-border bg-white p-5">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-brand">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-base font-semibold text-ink">{title}</h3>
              <p className="mt-1 text-sm text-ink-muted">{body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="services-consumer-heading"
        className="border-t border-surface-border bg-surface-soft"
      >
        <div className="page-gutter mx-auto max-w-3xl py-12 text-center sm:py-14">
          <h2 id="services-consumer-heading" className="mb-2 text-2xl font-bold text-ink">
            Be the first to know
          </h2>
          <p className="mb-6 text-[15px] text-ink-muted">
            Join the waitlist for early access to {PILLAR}. You need a {BRAND.siteName} account.
          </p>
          <WaitlistButton
            waitlist={waitlist}
            kind="services-consumer"
            idleLabel="Join the Waitlist"
            describedBy="services-consumer-consent"
          />
          <p
            id="services-consumer-consent"
            className="mx-auto mt-4 max-w-md text-xs text-ink-muted"
          >
            We use your account email only to tell you when {PILLAR} opens. You can leave the list
            at any time.
          </p>
        </div>
      </section>

      <section
        aria-labelledby="services-provider-heading"
        className="border-t border-surface-border"
      >
        <div className="page-gutter mx-auto max-w-3xl py-12 text-center sm:py-14">
          <h2 id="services-provider-heading" className="mb-2 text-2xl font-bold text-ink">
            Do you offer a home service?
          </h2>
          <p className="mb-6 text-[15px] text-ink-muted">
            Tell us you want to be listed on {PILLAR} when it opens. This is not a sign-up for a
            business account. You need a {BRAND.siteName} account.
          </p>
          <WaitlistButton
            waitlist={waitlist}
            kind="services-provider"
            idleLabel="Register your interest"
            describedBy="services-provider-consent"
          />
          <p
            id="services-provider-consent"
            className="mx-auto mt-4 max-w-md text-xs text-ink-muted"
          >
            We use your account email only to tell you when {PILLAR} opens to providers. You can
            leave the list at any time.
          </p>
        </div>
      </section>
    </div>
  );
}
