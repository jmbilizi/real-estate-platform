'use client';

import { Check, MapPin, MessageCircle, Users } from 'lucide-react';
import { BRAND } from '@/lib/brand';
import { useWaitlist } from '@/lib/useWaitlist';

const PILLAR = BRAND.pillars.connect;

// Plain descriptions of what the product will do. No counts, names or activity: none exist yet.
const WILL_HAVE = [
  {
    icon: MapPin,
    title: 'Follow the places you care about',
    body: 'Pick the neighborhoods you want to keep up with and see what people there are talking about.',
  },
  {
    icon: MessageCircle,
    title: 'Ask, answer, swap tips',
    body: 'Questions about buying, selling, renting or fixing up a home, answered by the community.',
  },
  {
    icon: Users,
    title: 'Real conversations',
    body: 'Sign up to read and take part. The conversation stays with people who have an account.',
  },
];

export default function ConnectPage() {
  const { ready, isJoined, isBusy, toggle } = useWaitlist();
  const joined = isJoined('connect');
  const busy = isBusy('connect');

  return (
    <div className="min-h-screen bg-white">
      <section className="bg-gradient-to-b from-surface-soft to-white">
        <div className="page-gutter mx-auto max-w-6xl pb-2 pt-12 text-center sm:pt-16">
          <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-brand/20 bg-brand-50 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-700">
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            Coming Soon
          </span>
          <h1 className="font-display text-3xl font-bold tracking-tight text-ink">
            {PILLAR} is coming.
            <br />
            <span className="text-brand">Your neighborhood has a lot to say.</span>
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-lg text-ink-muted">
            Soon you can follow the places you care about, ask questions and swap tips about homes.
            Get on the list and we will tell you when {PILLAR} opens.
          </p>
        </div>
      </section>

      <section className="page-gutter mx-auto max-w-6xl py-10 sm:py-14">
        <h2 className="sr-only">What {PILLAR} will include</h2>
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {WILL_HAVE.map(({ icon: Icon, title, body }) => (
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

      <section className="border-t border-surface-border bg-surface-soft">
        <div className="page-gutter mx-auto max-w-3xl py-12 text-center sm:py-14">
          <h2 className="mb-2 text-2xl font-bold text-ink">Be the first to know</h2>
          <p className="mb-6 text-[15px] text-ink-muted">
            Join the waitlist for early access to {PILLAR}. You need a {BRAND.siteName} account.
          </p>
          <button
            type="button"
            className={`${joined ? 'btn-secondary' : 'btn-primary'} min-h-11 w-full sm:w-auto`}
            disabled={!ready || busy}
            aria-pressed={joined}
            onClick={() => toggle('connect')}
          >
            {joined ? (
              <>
                <Check className="mr-2 h-4 w-4" aria-hidden="true" />
                You&apos;re on the list
              </>
            ) : (
              'Join the Waitlist'
            )}
          </button>
          {joined && (
            <p className="mt-3 text-sm text-ink-muted">Tap the button again to leave the list.</p>
          )}
          <p className="mx-auto mt-4 max-w-md text-xs text-ink-muted">
            We use your account email only to tell you when {PILLAR} opens. You can leave the list
            at any time.
          </p>
        </div>
      </section>
    </div>
  );
}
