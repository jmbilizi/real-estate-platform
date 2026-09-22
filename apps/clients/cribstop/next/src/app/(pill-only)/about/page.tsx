'use client';

import { BRAND } from '@/lib/brand';

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
      <h1 className="font-display text-3xl font-extrabold sm:text-4xl">
        About {BRAND.brokerageShort}
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-ink-muted">
        {BRAND.siteDomain} is your modern real estate marketplace, designed to make buying, selling,
        and renting homes as seamless as booking a trip. We combine beautiful design with powerful
        search to help you find your perfect home in the DMV area.
      </p>

      <div className="mt-12 grid gap-8 sm:grid-cols-2">
        <div className="rounded-2xl border border-surface-border bg-white p-6 shadow-card">
          <h2 className="font-display text-xl font-bold">Our Brokerage</h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-muted">
            {BRAND.siteDomain} is proudly operated under <strong>{BRAND.brokerage}</strong>, a
            nationally recognized, technology-driven real estate brokerage. Our agents leverage
            cutting-edge tools to deliver a premium experience for every client.
          </p>
        </div>
        <div className="rounded-2xl border border-surface-border bg-white p-6 shadow-card">
          <h2 className="font-display text-xl font-bold">Our Mission</h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-muted">
            We believe finding a home should be inspiring, not overwhelming. Every feature on{' '}
            {BRAND.siteDomain} is designed to give you confidence—from transparent broker
            attribution to neighborhood insights.
          </p>
        </div>
      </div>

      {/* Fair housing */}
      <div className="mt-12 rounded-2xl border border-surface-border bg-surface-alt p-8">
        <h2 className="font-display text-xl font-bold">Fair Housing & Compliance</h2>
        <div className="mt-4 space-y-3 text-sm leading-relaxed text-ink-muted">
          <p>
            {BRAND.brokerageShort} is committed to the principles of the Fair Housing Act. We do not
            discriminate on the basis of race, color, religion, sex, handicap, familial status, or
            national origin.
          </p>
          {/*
           * This card deliberately makes NO claim about where listing data comes from, and states
           * no dataset-freshness value. Both used to live here as static prose and both were
           * false: every row is `source='internal'` (#21 asserts it) with no Bright content
           * licence yet (#33), and a hardcoded "Data last updated" date is wrong on every day but
           * one (PRD §6.3 — a fabricated fact on a compliance disclosure).
           *
           * Neither is re-derived here, because neither belongs here:
           *
           * - **Provenance.** The site-level attribution IDX display rules actually require is the
           *   `sources`-gated block in `components/Footer.tsx`, which renders only when
           *   `GET /property/listings/meta` reports `brightMLS`. `Footer` is mounted in the root
           *   `app/layout.tsx`, so it is already on this route — removing the sentence that was
           *   here removed an unapproved *editorial* claim, not a required disclosure. Approved
           *   replacement wording is #33's to deliver with broker sign-off; do not reintroduce it
           *   by hand here. `about/page.spec.tsx` fails if anyone does.
           * - **Freshness.** The same footer states it once per route from that endpoint, omitting
           *   the line entirely when `dataUpdatedAt` is null rather than substituting today. One
           *   fact, one source; a second copy here could only ever disagree with it.
           *
           * What remains below is source-neutral and true of our own inventory exactly as it would
           * be of Bright's.
           */}
          <p>
            Some properties which appear for sale or rent on this website may no longer be available
            because they are under contract, have closed, or are no longer being offered for sale or
            rent.
          </p>
          <p className="font-medium text-ink">
            Brokered by {BRAND.brokerageShort}. {BRAND.equalHousingOpportunity}.
          </p>
        </div>
      </div>

      {/* Contact */}
      <div className="mt-12">
        <h2 className="font-display text-xl font-bold">Get in Touch</h2>
        <div className="mt-4 space-y-1 text-sm text-ink-muted">
          <p>{BRAND.brokerageShort}</p>
          <p>
            <a className="underline hover:text-ink" href={`mailto:${BRAND.contactEmail}`}>
              {BRAND.contactEmail}
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
